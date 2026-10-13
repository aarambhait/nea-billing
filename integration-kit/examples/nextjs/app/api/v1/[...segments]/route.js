import {api} from '../../../../lib/nea/api.mjs';
export const runtime='nodejs';
export const GET=request=>api(request);
export const POST=request=>api(request);
export const OPTIONS=request=>api(request);
