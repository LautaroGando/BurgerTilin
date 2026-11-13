import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, opening, csvCell, phoneKey } from '../src/domain';
test('horario de Buenos Aires cruza medianoche y respeta cierres excepcionales', () => {
  const s = { ...defaults, paused: false, schedule: [{ day: 5, open: '20:00', close: '02:00' }] };
  assert.equal(opening(s, new Date('2026-10-24T04:30:00Z')).open, true);
  assert.equal(opening(s, new Date('2026-10-24T05:00:00Z')).open, false);
  assert.equal(
    opening({ ...s, closures: ['2026-10-24'] }, new Date('2026-10-24T04:30:00Z')).open,
    false,
  );
  assert.equal(opening({ ...s, paused: true }, new Date('2026-10-24T04:30:00Z')).open, false);
  assert.ok(opening(s, new Date('2026-10-24T05:00:00Z')).nextOpen);
});
test('CSV protege fórmulas y duplica comillas para Excel', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('a"b'), '"a""b"');
});
test('teléfonos con formato equivalente producen la misma clave', () => {
  assert.equal(phoneKey('+54 (11) 1234-5678'), phoneKey('0054 11 12345678'));
});
