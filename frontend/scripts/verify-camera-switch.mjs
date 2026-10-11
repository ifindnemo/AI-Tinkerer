// Two virtual USB/webcam devices backed by Chromium's fake stream; no physical camera required.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
const browser = await chromium.launch({args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    const nativeGet = media.getUserMedia.bind(media);
    window.cameraRequests = [];
    window.cameraStreams = [];
    window.cameraDevices = ['builtin', 'usb'];
    media.enumerateDevices = async () => window.cameraDevices.map(deviceId => ({kind: 'videoinput', deviceId, label: deviceId === 'usb' ? 'USB External Camera' : 'Built-in Camera', groupId: deviceId}));
    media.getUserMedia = async constraints => {
      window.cameraRequests.push(constraints);
      const deviceId = constraints.video.deviceId?.exact || 'builtin';
      if (!window.cameraDevices.includes(deviceId)) throw new DOMException('unplugged', 'NotFoundError');
      const stream = await nativeGet({audio: false, video: true});
      const track = stream.getVideoTracks()[0], settings = track.getSettings.bind(track);
      track.getSettings = () => ({...settings(), deviceId});
      window.cameraStreams.push(stream);
      return stream;
    };
  });
  await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:3000'}/driver`);
  const select = page.getByTestId('camera-select');
  await expect(select.locator('option')).toHaveCount(3);
  await select.selectOption('usb');
  assert.equal(await page.evaluate(() => window.cameraRequests.length), 0, 'selection while idle does not open the camera');
  await page.getByTestId('start-camera').click();
  await expect(select).toBeEnabled({timeout: 30_000});
  assert.equal(await page.evaluate(() => window.cameraRequests[0].video.deviceId.exact), 'usb');
  await select.selectOption('builtin');
  await expect.poll(() => page.evaluate(() => window.cameraRequests.length)).toBe(2);
  assert.ok(await page.evaluate(() => window.cameraStreams[0].getTracks().every(t => t.readyState === 'ended')), 'switch releases previous camera');
  await expect(select).toBeEnabled({timeout: 30_000});
  assert.equal(await page.evaluate(() => window.cameraRequests[1].video.deviceId.exact), 'builtin');
  await page.evaluate(() => {
    window.cameraDevices = ['usb'];
    window.cameraStreams[1].getVideoTracks()[0].dispatchEvent(new Event('ended'));
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  await expect(page.getByTestId('driver-error')).toContainText('Camera đã mất kết nối');
  assert.ok(await page.evaluate(() => window.cameraStreams[1].getTracks().every(t => t.readyState === 'ended')));
  await expect(select.locator('option[value="builtin"]')).toContainText('chưa kết nối');
  await select.selectOption('usb');
  await page.getByTestId('start-camera').click();
  await expect(select).toBeEnabled({timeout: 30_000});
  await page.getByRole('button', {name: 'Dừng', exact: true}).click();
  assert.ok(await page.evaluate(() => window.cameraStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({width, height: 900});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: select before consent, exact device constraints, live switching, old-stream cleanup, unplug, recovery, stop and responsive layout.');
} finally { await browser.close(); }
