const assert = require('assert');
const {
  normalizeChannel,
  resolveRequestedService,
} = require('../utils/booking-normalization');

function expectService(input, expected) {
  const result = resolveRequestedService(input);
  assert(result, `Expected "${input}" to resolve to a service`);
  assert.strictEqual(result.officialService, expected, `Unexpected service for "${input}"`);
}

expectService('Corte de cabello', 'Corte de cabello');
expectService('cortarme el pelo', 'Corte de cabello');
expectService('BARBA CON NAVAJA', 'Recorte de barba + perfilado a navaja con toallas calientes');
expectService('coloracion', 'Coloración permanente');
expectService('barba y unas mechas por favor', 'Recorte de barba a máquina');
expectService('corte y barba', 'Corte y barba');

const multiple = resolveRequestedService('quiero corte de pelo y unas mechas');
assert(multiple.additionalServices.length >= 1, 'Expected extra detected services for a multi-service phrase');

assert.strictEqual(normalizeChannel('llamada', 'web'), 'phone');
assert.strictEqual(normalizeChannel('voz', 'web'), 'phone');

console.log('booking normalization tests passed');
