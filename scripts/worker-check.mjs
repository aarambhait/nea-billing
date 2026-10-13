// Smoke test for the built Worker entry: loads every bundled module and serves the UI and API.
import assert from 'node:assert/strict';
const worker=(await import('../dist/server/index.js')).default;
const page=await worker.fetch(new Request('https://example.com/'),{});
assert.equal(page.status,200);assert.match(await page.text(),/<!doctype html>/i);
const health=await worker.fetch(new Request('https://example.com/api/v1/health'),{REQUIRE_API_RATE_LIMIT:'true'});
assert.equal((await health.json()).status,'ok');
assert.equal((await worker.fetch(new Request('https://example.com/missing'),{})).status,404);
console.log('Built Worker serves the UI and API.');
