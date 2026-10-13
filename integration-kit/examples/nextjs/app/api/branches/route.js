import {api} from '../../../lib/nea/api.mjs';
export const runtime='nodejs';
export async function GET(request) {
  return api(request);
}
