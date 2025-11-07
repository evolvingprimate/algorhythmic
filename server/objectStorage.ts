// Object storage service for storing AI-generated artwork permanently
// Based on blueprint:javascript_object_storage
import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import { storage } from "./storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// The object storage client is used to interact with the object storage service
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  // Gets the public object search paths
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  // Search for a public object from the search paths
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      // Full path format: /<bucket_name>/<object_name>
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Check if file exists
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  // Downloads an object to the response
  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      // Get file metadata
      const [metadata] = await file.getMetadata();

      // Set appropriate headers
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `public, max-age=${cacheTtlSec}`,
      });

      // Stream the file to the response
      const stream = file.createReadStream();

      stream.on("error", (err: Error) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Download image from DALL-E URL and store in object storage with verification
  async storeImageFromUrl(imageUrl: string, userId?: string, maxRetries: number = 3): Promise<string> {
    let lastError: Error | null = null;
    let fileName: string = '';
    let fileSize: number = 0;
    const startTime = Date.now();
    const orphanedFiles: File[] = []; // Track files for cleanup on failure

    // Retry logic: Try up to maxRetries times
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[ObjectStorage] 📥 Attempt ${attempt}/${maxRetries}: Downloading from DALL-E...`);
        
        const publicPaths = this.getPublicObjectSearchPaths();
        if (publicPaths.length === 0) {
          throw new Error("No public object search paths configured");
        }

        // Use the first public path for storing generated artwork
        const publicPath = publicPaths[0];
        
        // Generate unique filename with UUID
        const imageId = randomUUID();
        fileName = `artwork-${imageId}.png`;
        const fullPath = `${publicPath}/${fileName}`;

        const { bucketName, objectName } = parseObjectPath(fullPath);
        const bucket = objectStorageClient.bucket(bucketName);
        const file = bucket.file(objectName);
        
        // Track file for potential cleanup
        orphanedFiles.push(file);

        // Download image from DALL-E URL
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to download image: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const downloadedSize = buffer.length;
        fileSize = downloadedSize; // Track for metrics
        
        console.log(`[ObjectStorage] ✅ Downloaded ${downloadedSize} bytes`);

        // Upload to object storage
        console.log(`[ObjectStorage] ⬆️  Uploading to storage: ${fullPath}`);
        await file.save(buffer, {
          metadata: {
            contentType: 'image/png',
            cacheControl: 'public, max-age=31536000', // 1 year cache
          },
        });

        console.log(`[ObjectStorage] 🔍 Verifying upload...`);

        // VERIFICATION STEP 1: Check file exists
        const [exists] = await file.exists();
        if (!exists) {
          throw new Error('Verification failed: File does not exist after upload');
        }
        console.log(`[ObjectStorage] ✅ File exists`);

        // VERIFICATION STEP 2: Check file metadata and size
        const [metadata] = await file.getMetadata();
        const uploadedSize = typeof metadata.size === 'number' 
          ? metadata.size 
          : parseInt(metadata.size || '0', 10);
        
        if (uploadedSize !== downloadedSize) {
          throw new Error(
            `Verification failed: Size mismatch (downloaded: ${downloadedSize}, uploaded: ${uploadedSize})`
          );
        }
        console.log(`[ObjectStorage] ✅ Size verified: ${uploadedSize} bytes`);

        // VERIFICATION STEP 3: Try reading first few bytes to ensure file is accessible
        const stream = file.createReadStream({ start: 0, end: 1023 }); // Read first 1KB
        const chunks: Buffer[] = [];
        
        await new Promise<void>((resolve, reject) => {
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => resolve());
          stream.on('error', (err) => reject(err));
          setTimeout(() => reject(new Error('Read timeout after 5s')), 5000);
        });

        const readBytes = Buffer.concat(chunks).length;
        if (readBytes === 0) {
          throw new Error('Verification failed: Could not read file data');
        }
        console.log(`[ObjectStorage] ✅ File is readable (read ${readBytes} bytes)`);

        // All verifications passed!
        const publicUrl = `/public-objects/${fileName}`;
        const verificationTimeMs = Date.now() - startTime;
        console.log(`[ObjectStorage] 🎉 Storage verified successfully: ${publicUrl}`);
        
        // Record success metrics
        try {
          await storage.recordStorageMetric({
            userId: userId || null,
            fileName,
            fileSize,
            dalleUrl: imageUrl,
            storageUrl: publicUrl,
            attemptCount: attempt,
            success: true,
            verificationTimeMs,
            errorMessage: null,
          });
          console.log(`[ObjectStorage] 📊 Metrics recorded: ${attempt} attempts, ${verificationTimeMs}ms`);
        } catch (metricsError) {
          // Don't fail the whole operation if metrics recording fails
          console.error(`[ObjectStorage] ⚠️  Failed to record metrics:`, metricsError);
        }
        
        return publicUrl;

      } catch (error) {
        lastError = error as Error;
        console.error(`[ObjectStorage] ❌ Attempt ${attempt}/${maxRetries} failed:`, error);
        
        if (attempt < maxRetries) {
          const delayMs = attempt * 1000; // Exponential backoff: 1s, 2s, 3s
          console.log(`[ObjectStorage] ⏳ Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries exhausted - cleanup orphaned files and record failure
    console.error(`[ObjectStorage] 💥 All ${maxRetries} attempts failed. Last error:`, lastError);
    
    // Cleanup: Delete orphaned partial uploads
    console.log(`[ObjectStorage] 🧹 Cleaning up ${orphanedFiles.length} orphaned files...`);
    for (const orphanedFile of orphanedFiles) {
      try {
        await orphanedFile.delete();
        console.log(`[ObjectStorage] ✅ Deleted orphaned file: ${orphanedFile.name}`);
      } catch (cleanupError) {
        console.error(`[ObjectStorage] ⚠️  Failed to delete orphaned file:`, cleanupError);
      }
    }
    
    // Record failure metrics
    const verificationTimeMs = Date.now() - startTime;
    try {
      await storage.recordStorageMetric({
        userId: userId || null,
        fileName: fileName || 'unknown',
        fileSize: fileSize || null,
        dalleUrl: imageUrl,
        storageUrl: null,
        attemptCount: maxRetries,
        success: false,
        verificationTimeMs,
        errorMessage: lastError?.message || 'Unknown error',
      });
      console.log(`[ObjectStorage] 📊 Failure metrics recorded: ${maxRetries} attempts, ${verificationTimeMs}ms`);
    } catch (metricsError) {
      console.error(`[ObjectStorage] ⚠️  Failed to record failure metrics:`, metricsError);
    }
    
    throw new Error(
      `Failed to store image after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}
