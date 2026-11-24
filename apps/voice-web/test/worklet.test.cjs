// 主逻辑
// 用模拟 AudioWorklet 环境验证 44.1 kHz 输入的重采样、分包和尾帧回传。

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

test('AudioWorklet 以 100 ms 分包并在停止录音时发送尾包', () => {
  let Processor;
  const posted = [];
  const sampleRate = 44_100;
  runInNewContext(readFileSync(resolve(__dirname, '../public/pcm-capture.js'), 'utf8'), {
    AudioWorkletProcessor: class {
      port = {
        postMessage(data, transfer = []) {
          posted.push(structuredClone(data, { transfer }));
        },
      };
    },
    sampleRate,
    registerProcessor(_name, processor) {
      Processor = processor;
    },
  });
  const worklet = new Processor({ processorOptions: { rate: 16_000, frameBytes: 3_200 } });
  const sampleCount = sampleRate * 0.25;
  for (let i = 0; i < sampleCount; i += 128) {
    const count = Math.min(128, sampleCount - i);
    worklet.process([[new Float32Array(count).fill(-0.25)]]);
  }
  assert.equal(posted.length, 2);
  worklet.port.onmessage();
  assert.deepEqual(
    posted.map((data) => data.byteLength ?? data),
    [3_200, 3_200, 1_600, 'flushed'],
  );
  assert.equal(new DataView(posted[0]).getInt16(0, true), -8192);
});
