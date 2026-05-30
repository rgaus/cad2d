/** Result of a save file picker operation. */
export type SaveFilePickerResult = {
  /** The file handle, or null if File System Access API was unavailable and fallback was used. */
  handle: FileSystemFileHandle | null;
  /** True if a fallback download method was used because API was unavailable. */
  usedFallback: boolean;
};

/** Result of a load file picker operation. */
export type LoadFilePickerResult = {
  /** The file handle, or null if File System Access API was unavailable and fallback was used. */
  handle: FileSystemFileHandle | null;
  /** True if a fallback input method was used because API was unavailable. */
  usedFallback: boolean;
  /** The file content as a string. Present when successfully picking a file (either API or fallback). */
  content: string | null;
  /** The filename, if available. */
  name: string | null;
};

/**
 * Checks if the File System Access API is available.
 */
function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

/**
 * Checks if we can create a fallback download link (a[download]).
 * Requires document.createElement to be available.
 */
function canCreateDownloadFallback(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/**
 * Checks if we can create a fallback file input.
 * Requires document.createElement to be available.
 */
function canCreateFileInputFallback(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/**
 * Opens a file picker dialog to select a file for loading.
 * Uses File System Access API if available, otherwise falls back to input[type=file].
 *
 * @returns A promise resolving to { handle, usedFallback, content, name }.
 *          handle is a FileSystemFileHandle if API was used, null if fallback was used.
 *          usedFallback is true if the fallback method was used.
 *          content is the file content as a string, or null if user cancelled/error.
 *          name is the filename if available.
 */
export async function pickFileToLoad(): Promise<LoadFilePickerResult> {
  if (hasFileSystemAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'SVG Files',
            accept: { 'image/svg+xml': ['.svg'] },
          },
        ],
      });
      const file = await handle.getFile();
      const content = await file.text();
      return { handle, usedFallback: false, content, name: file.name };
    } catch (err) {
      // User cancelled or error
      if ((err as Error).name === 'AbortError') {
        return { handle: null, usedFallback: false, content: null, name: null };
      }
      console.error('[cad2d] File System Access API error:', err);
      // Fall through to fallback
    }
  }

  // Fallback to input[type=file]
  if (!canCreateFileInputFallback()) {
    console.error('[cad2d] Cannot create file input - document not available');
    return { handle: null, usedFallback: false, content: null, name: null };
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg,image/svg+xml';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ handle: null, usedFallback: true, content: null, name: null });
        return;
      }

      try {
        const content = await file.text();
        resolve({ handle: null, usedFallback: true, content, name: file.name });
      } catch (err) {
        console.error('[cad2d] Failed to read file:', err);
        resolve({ handle: null, usedFallback: true, content: null, name: null });
      }
    };

    input.oncancel = () => {
      resolve({ handle: null, usedFallback: true, content: null, name: null });
    };

    // Append, click, remove
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });
}

/**
 * Reads file content from a FileSystemFileHandle.
 * Throws if the handle doesn't support reading (e.g., from fallback).
 */
export async function readFileFromHandle(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return await file.text();
}

/**
 * Reads file content from a File object (fallback from input[type=file]).
 */
export async function readFileFromFileObject(file: File): Promise<string> {
  return await file.text();
}

/**
 * Opens a file picker dialog to select a location for saving.
 * Uses File System Access API if available, otherwise falls back to a[download].
 *
 * @returns A promise resolving to { handle, usedFallback }.
 *          handle is a FileSystemFileHandle if API was used, null if fallback was used.
 *          usedFallback is true if the fallback method was used (download).
 * @throws Error if neither API nor fallback is available.
 */
export async function pickFileToSave(): Promise<SaveFilePickerResult> {
  if (hasFileSystemAccess()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'drawing.svg',
        types: [
          {
            description: 'SVG File',
            accept: { 'image/svg+xml': ['.svg'] },
          },
        ],
      });
      return { handle, usedFallback: false };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return { handle: null, usedFallback: false };
      }
      console.error('[cad2d] File System Access API error:', err);
      // Fall through to fallback
    }
  }

  // Fallback to a[download]
  if (!canCreateDownloadFallback()) {
    console.error('[cad2d] Cannot create download link - document not available');
    throw new Error('File System Access API not available and download fallback not possible');
  }

  // We return null handle for fallback - caller should not store the "handle"
  return { handle: null, usedFallback: true };
}

/**
 * Writes SVG content to a FileSystemFileHandle.
 *
 * @param handle A FileSystemFileHandle obtained from showSaveFilePicker
 * @param svg The SVG content to write
 * @returns A promise resolving to true if successful, false otherwise
 */
export async function saveToHandle(handle: FileSystemFileHandle, svg: string): Promise<boolean> {
  try {
    const writable = await handle.createWritable();
    await writable.write(svg);
    await writable.close();
    return true;
  } catch (err) {
    console.error('[cad2d] Failed to write to file handle:', err);
    return false;
  }
}

/**
 * Triggers a download of SVG content using an ephemeral a[download] element.
 *
 * @param svg The SVG content to download
 * @param filename The suggested filename for the download
 */
export function triggerDownload(svg: string, filename: string): void {
  if (!canCreateDownloadFallback()) {
    console.error('[cad2d] Cannot create download link - document not available');
    return;
  }

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Augment Window type for File System Access API
declare global {
  interface Window {
    showOpenFilePicker(options?: {
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }): Promise<Array<FileSystemFileHandle>>;
    showSaveFilePicker(options?: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }): Promise<FileSystemFileHandle>;
  }
}
