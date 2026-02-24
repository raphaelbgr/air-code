import toast from 'react-hot-toast';
import { api } from './api';
import { terminalChannel } from './terminal-channel';

/**
 * Creates a capture-phase paste event handler that intercepts image pastes,
 * uploads the image to the server, and types the resulting file path into
 * the terminal. Normal text pastes are left untouched for xterm.js to handle.
 */
export function createImagePasteHandler(sessionId: string): EventListener {
  return (async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let imageItem: DataTransferItem | null = null;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        imageItem = item;
        break;
      }
    }
    if (!imageItem) return; // no image — let xterm handle the paste

    e.preventDefault();
    e.stopPropagation();

    const blob = imageItem.getAsFile();
    if (!blob) return;

    const toastId = toast.loading('Uploading image...');
    try {
      const { path } = await api.sessions.uploadImage(sessionId, blob);
      terminalChannel.sendInput(sessionId, path);
      toast.success('Image path pasted', { id: toastId });
    } catch (err) {
      toast.error(`Image upload failed: ${err instanceof Error ? err.message : err}`, { id: toastId });
    }
  }) as unknown as EventListener;
}
