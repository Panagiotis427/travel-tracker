// Photo import's EXIF reader, off the main thread: a batch of photos comes in and one fix
// per photo goes back, so reading thousands of photos never stalls the map.
import { readPhotoFix } from './exif';
import type { FixReply, FixRequest, PhotoFix } from './exif';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<FixRequest>) => void) | null;
  postMessage(m: FixReply): void;
};

scope.onmessage = async (e) => {
  const fixes: Array<PhotoFix | null> = [];
  for (const f of e.data.files) fixes.push(await readPhotoFix(f));
  scope.postMessage({ id: e.data.id, fixes });
};
