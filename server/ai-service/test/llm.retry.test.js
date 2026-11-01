const { config } = require('../src/config');
const { complete } = require('../src/services/llm');

beforeEach(() => {
  config.LLM_API_KEY = 'test-key';
  config.LLM_TIMEOUT_MS = 1000;
});

function response(status, headers = {}) {
  return { ok: false, status, headers: { get: (name) => headers[name] } };
}

test.each([401, 429])('does not retry provider %s responses', async (status) => {
  const fetchImpl = jest.fn().mockResolvedValue(response(status, { 'retry-after': '0' }));
  await expect(complete([{ role: 'user', content: 'hi' }], { fetchImpl })).rejects.toThrow(`returned ${status}`);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('retries a provider 500 once', async () => {
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce(response(500))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
  await expect(complete([{ role: 'user', content: 'hi' }], { fetchImpl })).resolves.toEqual({ content: 'ok' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});