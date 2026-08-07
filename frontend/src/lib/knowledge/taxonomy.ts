const TECHNOLOGY_PATTERNS: Array<[string, RegExp]> = [
  ['IRMS', /\bIRMS\b|\bisotope[\s-]ratio mass spectrom(?:eter|etry)\b/i],
  ['GC-IRMS', /\bGC[\s-]?IRMS\b|\bgas chromatograph(?:y)?[\s-]+IRMS\b/i],
  ['EA-IRMS', /\bEA[\s-]?IRMS\b|\belemental analy[sz]er[\s-]+IRMS\b/i],
  ['ICP-MS', /\bICP[\s-]?MS\b|\binductively coupled plasma mass spectrom(?:eter|etry)\b/i],
  ['GC-MS', /\bGC[\s-]?MS\b|\bgas chromatography[\s-]+mass spectrom(?:eter|etry)\b/i],
  ['LC-MS', /\bLC[\s-]?MS\b|\bliquid chromatography[\s-]+mass spectrom(?:eter|etry)\b/i],
];

const COMPONENT_PATTERNS: Array<[string, RegExp]> = [
  ['ion source', /\bion source\b/i],
  ['Faraday cup', /\bFaraday cup\b/i],
  ['collector', /\bcollector(?:s)?\b/i],
  ['filament', /\bfilament\b/i],
  ['capillary', /\bcapillar(?:y|ies)\b/i],
  ['combustion reactor', /\bcombustion reactor\b/i],
  ['reduction reactor', /\breduction reactor\b/i],
  ['autosampler', /\bauto[\s-]?sampler\b/i],
  ['vacuum pump', /\b(?:turbo|rotary|vacuum) pump\b/i],
  ['gas chromatograph', /\bgas chromatograph\b|\bGC column\b/i],
  ['elemental analyzer', /\belemental analy[sz]er\b/i],
  ['open split', /\bopen split\b/i],
  ['reference gas', /\breference gas\b/i],
];

const METHOD_PATTERNS: Array<[string, RegExp]> = [
  ['calibration', /\bcalibrat(?:e|ed|ing|ion)\b/i],
  ['normalization', /\bnormal(?:i[sz]e|i[sz]ed|i[sz]ation)\b/i],
  ['blank correction', /\bblank correction\b/i],
  ['linearity correction', /\blinearity correction\b/i],
  ['leak check', /\bleak (?:check|test)\b/i],
  ['peak integration', /\bpeak integrat(?:e|ion|ing)\b/i],
  ['combustion', /\bcombust(?:ion|ed|ing)\b/i],
  ['pyrolysis', /\bpyroly(?:sis|tic|ze|sed)\b/i],
  ['chromatography', /\bchromatograph(?:y|ic)\b/i],
];

const PRODUCT_PATTERNS: Array<[string, RegExp]> = [
  ['Thermo Delta', /\b(?:Thermo|Finnigan)?\s*Delta\s+(?:V|Plus|XP|S)\b/i],
  ['Thermo MAT 253', /\b(?:Thermo|Finnigan)?\s*MAT\s*253(?:\s*Plus)?\b/i],
  ['Thermo GasBench', /\bGasBench\s*(?:II|2)?\b/i],
  ['Thermo ConFlo', /\bConFlo\s*(?:II|III|IV|2|3|4)?\b/i],
  ['Thermo EA IsoLink', /\bEA\s*IsoLink\b/i],
  ['Isoprime', /\bIsoPrime(?:100|PrecisION)?\b/i],
  ['Sercon', /\bSercon\b|\b20-2[02]\b/i],
  ['Costech ECS', /\bCostech\b|\bECS\s*4010\b/i],
  ['Carlo Erba', /\bCarlo\s+Erba\b|\bNA\s*1500\b/i],
];

function collectLabels(text: string, patterns: Array<[string, RegExp]>) {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function extractDeterministicMetadata(text: string) {
  const isotopes = unique(
    Array.from(
      text.matchAll(
        /(?:δ|d)?\s*(?:1[358]|2|3[346]|4[0248]|8[67])\s*(?:[A-Z][a-z]?|O|H|C|N|S|Cl|Ar|Ca|Sr)\b/gi,
      ),
      (match) => match[0].replace(/\s+/g, ''),
    ),
  );
  const errorCodes = unique(
    Array.from(
      text.matchAll(
        /\b(?:error|err|fault|alarm|code)[\s:#-]*([A-Z]{0,4}[-_]?\d{2,6}[A-Z]?)\b/gi,
      ),
      (match) => match[1],
    ),
  );
  const acronyms = unique(
    Array.from(text.matchAll(/\b[A-Z][A-Z0-9-]{2,11}\b/g), (match) => match[0]),
  ).slice(0, 40);

  return {
    products: collectLabels(text, PRODUCT_PATTERNS),
    components: collectLabels(text, COMPONENT_PATTERNS),
    technologies: collectLabels(text, TECHNOLOGY_PATTERNS),
    methods: collectLabels(text, METHOD_PATTERNS),
    isotopes,
    errorCodes,
    acronyms,
  };
}
