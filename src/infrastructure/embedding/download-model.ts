import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { basename, extname, join } from "node:path";

import type { LoggerPort } from "../../application/ports/logger-port.js";

const MAX_REDIRECTS = 10;
const REQUEST_TIMEOUT_MS = 120_000;
const INVALID_FILENAME_CHARS = /[^A-Za-z0-9._-]+/g;
const DEFAULT_MODEL_EXTENSION = ".gguf";

type ModelDownloadSource = {
  downloadUrl: string;
  filename: string;
};

export async function ensureModelFile(options: {
  logger?: LoggerPort;
  modelDir: string;
  source: ModelDownloadSource;
}): Promise<string> {
  const targetPath = join(options.modelDir, options.source.filename);

  if (existsSync(targetPath) && statSync(targetPath).size > 0) {
    options.logger?.info("Embedding model already exists", {
      event: "model.download.skip",
      filename: options.source.filename,
      path: targetPath,
    });
    return targetPath;
  }

  mkdirSync(options.modelDir, { recursive: true });

  options.logger?.info("Downloading embedding model", {
    event: "model.download",
    filename: options.source.filename,
    url: options.source.downloadUrl,
  });

  await downloadFile(options.source.downloadUrl, targetPath);

  options.logger?.info("Embedding model downloaded", {
    event: "model.download.complete",
    filename: options.source.filename,
  });

  return targetPath;
}

export function resolveModelDownloadFilename(url: string): string {
  const parsedUrl = new URL(url);
  const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  const pathnameBase = basename(parsedUrl.pathname);
  const sanitizedBase = sanitizeFilename(pathnameBase);

  if (sanitizedBase.length === 0) {
    return `model-${urlHash}${DEFAULT_MODEL_EXTENSION}`;
  }

  const extension = extname(sanitizedBase);
  const nameWithoutExtension =
    extension.length > 0
      ? sanitizedBase.slice(0, sanitizedBase.length - extension.length)
      : sanitizedBase;

  if (nameWithoutExtension.length === 0) {
    return `model-${urlHash}${extension || DEFAULT_MODEL_EXTENSION}`;
  }

  return `${nameWithoutExtension}-${urlHash}${extension}`;
}

function sanitizeFilename(value: string): string {
  return value
    .replace(INVALID_FILENAME_CHARS, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function downloadFile(url: string, dest: string): Promise<void> {
  const partialDest = `${dest}.part`;
  rmSync(partialDest, { force: true });

  return downloadToPartial(url, partialDest).then(() => {
    renameSync(partialDest, dest);
  });
}

function selectHttpClient(url: string): typeof httpsGet {
  const protocol = new URL(url).protocol;

  if (protocol === "https:") {
    return httpsGet;
  }

  if (protocol === "http:") {
    return httpGet;
  }

  throw new Error(`Unsupported model download protocol: ${protocol}`);
}

function downloadToPartial(
  url: string,
  dest: string,
  redirectCount = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      rmSync(dest, { force: true });
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const client = selectHttpClient(url);
    const request = client(url, (response) => {
      if (
        response.statusCode !== undefined &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location !== undefined &&
        response.headers.location.length > 0
      ) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          fail(new Error(`Download exceeded ${MAX_REDIRECTS} redirects`));
          return;
        }

        const nextUrl = new URL(response.headers.location, url).toString();
        downloadToPartial(nextUrl, dest, redirectCount + 1).then(resolve, fail);
        return;
      }

      if (response.statusCode !== undefined && response.statusCode >= 400) {
        response.resume();
        fail(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const stream = createWriteStream(dest);
      response.pipe(stream);

      stream.on("finish", () => {
        stream.close((error) => {
          if (error) {
            fail(error);
            return;
          }
          resolve();
        });
      });

      stream.on("error", fail);
      response.on("error", fail);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Download timed out"));
    });
    request.on("error", fail);
  });
}
