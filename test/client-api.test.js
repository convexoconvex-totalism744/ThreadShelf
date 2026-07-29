import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readNdjsonStream } from '../client/src/api.ts';

function makeNdjsonResponse(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status,
      headers: { 'content-type': status >= 400 ? 'application/json' : 'application/x-ndjson' },
    },
  );
}

describe('readNdjsonStream', () => {
  it('parses newline-delimited objects split across chunks', async () => {
    const events = [];
    const response = makeNdjsonResponse([
      '{"status":"starting"}\n{"status":"pro',
      'gress","processedFiles":1}\n{"status":"completed"}',
    ]);

    await readNdjsonStream(response, (event) => events.push(event));

    assert.deepStrictEqual(events, [
      { status: 'starting' },
      { status: 'progress', processedFiles: 1 },
      { status: 'completed' },
    ]);
  });

  it('throws ApiError-compatible failures for non-2xx responses', async () => {
    const response = makeNdjsonResponse(['{"error":"Bad clearFirst","field":"clearFirst"}'], {
      status: 400,
    });

    await assert.rejects(
      () => readNdjsonStream(response, () => {}),
      (error) =>
        error instanceof Error &&
        error.name === 'ApiError' &&
        error.message === 'Bad clearFirst' &&
        error.status === 400 &&
        error.field === 'clearFirst',
    );
  });

  it('reports malformed stream events with the offending payload', async () => {
    const response = makeNdjsonResponse(['{"status":"starting"}\nnot-json\n']);
    const events = [];

    await assert.rejects(
      () => readNdjsonStream(response, (event) => events.push(event)),
      /Invalid NDJSON event: not-json/,
    );
    assert.deepStrictEqual(events, [{ status: 'starting' }]);
  });
});
