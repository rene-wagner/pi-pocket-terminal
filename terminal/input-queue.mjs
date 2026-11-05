/** One session-bound, ordered input channel. Failed/uncertain writes are never retried. */
export function createInputQueue({ send, onError, chunkSize = 4096, maxPending = 65536 }) {
  let pending = '', sending = false, connected = false, alive = true;

  async function flush() {
    if (!alive || !connected || sending || !pending) return;
    sending = true;
    let end = Math.min(chunkSize, pending.length);
    // Never split a UTF-16 surrogate pair across JSON requests.
    if (end < pending.length && /[\uD800-\uDBFF]/.test(pending[end - 1]) && /[\uDC00-\uDFFF]/.test(pending[end])) end--;
    const data = pending.slice(0, end);
    pending = pending.slice(end);
    try {
      await send(data);
    } catch (error) {
      connected = false;
      pending = '';
      if (alive) onError(error);
    } finally {
      sending = false;
      if (alive && connected && pending) void flush();
    }
  }

  return {
    enqueue(data) {
      if (!alive || !connected || typeof data !== 'string' || !data) return false;
      if (pending.length + data.length > maxPending) {
        connected = false;
        pending = '';
        onError(new Error('Zu viele ausstehende Eingaben. Nicht gesendete Eingaben wurden verworfen.'));
        return false;
      }
      pending += data;
      void flush();
      return true;
    },
    setConnected(value) {
      connected = alive && Boolean(value);
      if (!connected) pending = '';
    },
    dispose() { alive = false; connected = false; pending = ''; },
  };
}
