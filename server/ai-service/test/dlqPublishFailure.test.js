const { withDLQ } = require('../../../shared/utils/dlqHandler');

test('failed DLQ publication retries then propagates instead of acknowledging the source record', async () => {
  jest.useFakeTimers();
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const producer = { send: jest.fn().mockRejectedValue(new Error('Kafka unavailable')) };
  const handle = withDLQ(producer, 'dlq.test', async () => { throw new Error('poison'); });
  const pending = handle({ topic: 'source', partition: 0, message: { value: Buffer.from('{'), offset: '10', headers: {} } });
  const rejection = expect(pending).rejects.toThrow('Kafka unavailable');
  await jest.runAllTimersAsync();
  await rejection;
  expect(producer.send).toHaveBeenCalledTimes(5);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('ALERT: DLQ publish failed'), expect.objectContaining({ offset: '10' }));
  log.mockRestore();
  jest.useRealTimers();
});
