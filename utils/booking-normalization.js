const OFFICIAL_SERVICES = [
  'Corte de cabello',
  'Recorte de barba + perfilado a navaja con toallas calientes',
  'Recorte de barba a máquina',
  'Camuflaje de canas',
  'Coloración permanente',
  'Mechas',
  'Tratamiento capilar',
  'Tratamiento hidratante barba',
  'Lavado de cabello',
  'Corte niño',
  'Corte jubilado y joven',
  'Corte y barba',
];

const SERVICE_VARIANTS = {
  'Corte de cabello': [
    'corte de cabello',
    'corte de pelo',
    'cortarme el pelo',
    'cortarme el cabello',
    'un corte',
    'corte',
    'pelarme',
    'peluquearme',
  ],
  'Recorte de barba + perfilado a navaja con toallas calientes': [
    'barba con navaja',
    'perfilado con navaja',
    'barba con toallas calientes',
    'barba navaja',
    'perfilado a navaja',
    'barba con navaja y toallas calientes',
    'recorte de barba + perfilado a navaja con toallas calientes',
  ],
  'Recorte de barba a máquina': [
    'barba',
    'solo barba',
    'recorte de barba',
    'barba a maquina',
    'barba a máquina',
    'arreglo de barba',
    'recorte de barba a maquina',
    'recorte de barba a máquina',
  ],
  'Camuflaje de canas': [
    'camuflaje de canas',
    'cubrir canas',
    'disimular canas',
    'tapar canas',
  ],
  'Coloración permanente': [
    'coloracion permanente',
    'coloración permanente',
    'coloracion',
    'coloración',
    'tinte',
    'teñirme',
    'tenirme',
  ],
  Mechas: [
    'mechas',
    'unas mechas',
  ],
  'Tratamiento capilar': [
    'tratamiento capilar',
    'tratamiento del cabello',
    'tratamiento pelo',
    'tratamiento capilar1',
  ],
  'Tratamiento hidratante barba': [
    'tratamiento hidratante barba',
    'hidratacion barba',
    'hidratación barba',
    'tratamiento barba',
  ],
  'Lavado de cabello': [
    'lavado de cabello',
    'lavado de pelo',
    'lavado',
  ],
  'Corte niño': [
    'corte niño',
    'corte nino',
    'corte niño hasta 10 años',
    'corte infantil',
    'corte para niño',
  ],
  'Corte jubilado y joven': [
    'corte jubilado y joven',
    'corte jubilado',
    'corte joven',
    'corte estudiante',
  ],
  'Corte y barba': [
    'corte y barba',
    'corte con barba',
    'pelo y barba',
    'corte cabello y barba',
  ],
};

const SERVICE_DATABASE_VARIANTS = {
  'Recorte de barba a máquina': ['Recorte de barba a maquina'],
  'Tratamiento capilar': ['Tratamiento capilar1'],
  'Corte niño': ['Corte niño (hasta 10 años)'],
};

const CHANNEL_VARIANTS = {
  phone: ['phone', 'llamada', 'llamadas', 'voz', 'telefono', 'teléfono', 'telefonica', 'telefónica', 'call'],
  whatsapp: ['whatsapp', 'wpp', 'wa'],
  web: ['web', 'formulario', 'online'],
  internal: ['internal', 'interno'],
};

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function getOfficialServiceVariants(serviceName) {
  return unique([
    serviceName,
    ...(SERVICE_VARIANTS[serviceName] || []),
    ...(SERVICE_DATABASE_VARIANTS[serviceName] || []),
  ]);
}

function scoreServiceMatch(normalizedInput, serviceName) {
  let score = 0;
  let earliestIndex = Number.POSITIVE_INFINITY;
  const variants = getOfficialServiceVariants(serviceName).map(normalizeComparableText);

  for (const variant of variants) {
    if (!variant) continue;
    if (normalizedInput === variant) {
      score = Math.max(score, 120 + variant.length);
      earliestIndex = 0;
      continue;
    }
    if (normalizedInput.includes(variant)) {
      earliestIndex = Math.min(earliestIndex, normalizedInput.indexOf(variant));
      score = Math.max(score, 80 + variant.length);
      continue;
    }
    const tokens = variant.split(' ').filter(Boolean);
    if (tokens.length > 1 && tokens.every((token) => normalizedInput.includes(token))) {
      const indexes = tokens.map((token) => normalizedInput.indexOf(token)).filter((index) => index >= 0);
      if (indexes.length) earliestIndex = Math.min(earliestIndex, ...indexes);
      score = Math.max(score, 40 + tokens.length);
    }
  }

  return {
    score,
    earliestIndex,
  };
}

function resolveRequestedService(input) {
  const rawInput = String(input || '').trim();
  const normalizedInput = normalizeComparableText(rawInput);
  if (!normalizedInput) return null;

  const exactComboMatch = getOfficialServiceVariants('Corte y barba')
    .map(normalizeComparableText)
    .some((variant) => normalizedInput === variant || normalizedInput.includes(variant));

  if (exactComboMatch) {
    return {
      rawInput,
      officialService: 'Corte y barba',
      matchedServices: ['Corte y barba'],
      additionalServices: [],
      notesSuffix: '',
    };
  }

  const matches = OFFICIAL_SERVICES
    .map((serviceName) => ({ serviceName, ...scoreServiceMatch(normalizedInput, serviceName) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (Math.abs(right.score - left.score) <= 15) {
        if (left.earliestIndex !== right.earliestIndex) {
          return left.earliestIndex - right.earliestIndex;
        }
      }
      return right.score - left.score;
    });

  if (!matches.length) return null;

  const officialService = matches[0].serviceName;
  const additionalServices = matches
    .slice(1)
    .map((entry) => entry.serviceName)
    .filter((serviceName) => serviceName !== officialService);

  const noteParts = [];
  if (additionalServices.length) {
    noteParts.push(`Servicios detectados en la solicitud: ${additionalServices.join(', ')}.`);
  }
  if (rawInput && normalizeComparableText(rawInput) !== normalizeComparableText(officialService)) {
    noteParts.push(`Solicitud original de servicio: ${rawInput}.`);
  }

  return {
    rawInput,
    officialService,
    matchedServices: unique(matches.map((entry) => entry.serviceName)),
    additionalServices: unique(additionalServices),
    notesSuffix: noteParts.join(' '),
  };
}

function normalizeChannel(input, fallback = 'web') {
  const normalizedInput = normalizeComparableText(input);
  if (!normalizedInput) return fallback;

  for (const [canonical, variants] of Object.entries(CHANNEL_VARIANTS)) {
    if (variants.map(normalizeComparableText).includes(normalizedInput)) {
      return canonical;
    }
  }

  return String(input || fallback).trim() || fallback;
}

function findCatalogServiceByOfficialName(services, officialService) {
  const acceptedNames = getOfficialServiceVariants(officialService).map(normalizeComparableText);
  return services.find((service) => acceptedNames.includes(normalizeComparableText(service.name))) || null;
}

function appendServiceNotes(existingNotes, resolution) {
  const currentNotes = String(existingNotes || '').trim();
  const extraNotes = String(resolution?.notesSuffix || '').trim();
  if (!extraNotes) return currentNotes;
  return currentNotes ? `${currentNotes}\n${extraNotes}` : extraNotes;
}

module.exports = {
  OFFICIAL_SERVICES,
  normalizeComparableText,
  normalizeChannel,
  resolveRequestedService,
  findCatalogServiceByOfficialName,
  appendServiceNotes,
};
