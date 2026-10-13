import {api} from '../../../lib/nea/api.mjs';
export const runtime='nodejs';
export async function POST(request) {
  // Apply your existing login and connection-ownership checks before calling api.
  return api(request);
}
