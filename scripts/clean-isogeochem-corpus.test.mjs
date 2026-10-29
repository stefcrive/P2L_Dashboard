import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyMessage,
  cleanMessageBody,
  parseMergedConversation,
  serializeRecord,
  subjectGenre,
  technicalSignals,
} from './clean-isogeochem-corpus.mjs';

function message(overrides = {}) {
  return {
    subjectNormalized: 'Delta XL heater connection',
    subjectRaw: 'Delta XL heater connection',
    authorRaw: 'Analyst',
    dateRaw: '1 Jan 2018',
    ...overrides,
  };
}

test('recognizes high-confidence administrative subject genres', () => {
  assert.equal(subjectGenre('Postdoctoral position in isotope geochemistry'), 'job_posting');
  assert.equal(subjectGenre('Endowed Chair - Ecosystems and Earth Systems Science'), 'job_posting');
  assert.equal(subjectGenre('Research Assistant Professor in Quaternary Science'), 'job_posting');
  assert.equal(subjectGenre('AGU session announcement: stable isotopes'), 'event_announcement');
  assert.equal(subjectGenre('Geofluids II conference'), 'event_announcement');
  assert.equal(subjectGenre('Diversity in Chemistry Seminar Series'), 'event_announcement');
  assert.equal(subjectGenre('MACA workshop'), 'event_announcement');
  assert.equal(subjectGenre('GasiR meeting 2005'), 'event_announcement');
  assert.equal(subjectGenre('Looking for used GasBench II'), 'commercial_posting');
  assert.equal(subjectGenre('Please unsubscribe me from the distribution list'), 'list_administration');
  assert.equal(subjectGenre('Automatic reply: out of the office'), 'list_administration');
});

test('does not classify ordinary technical subjects as administrative genres', () => {
  assert.equal(subjectGenre('MAT 253 problem with bellows'), null);
  assert.equal(subjectGenre('Carbonate reaction temperature for GasBench'), null);
});

test('recognizes technical messages missed by the original narrow taxonomy', () => {
  assert.equal(
    technicalSignals('nickel gaskets reacting with oxygen', 'The gasket fails after heating.').strong,
    true,
  );
  assert.equal(
    technicalSignals('gas bench blues', 'The pressure drops and the signal is unstable.').strong,
    true,
  );
});

test('removes strict boilerplate lines while preserving technical content', () => {
  const result = cleanMessageBody(
    'The MAT 253 signal is unstable at 10 mbar.\n\nTo unsubscribe, visit the subscription settings.',
  );
  assert.match(result.text, /MAT 253 signal/);
  assert.doesNotMatch(result.text, /unsubscribe/i);
  assert.ok(result.reasons.includes('boilerplate_removed'));
});

test('removes a contact-heavy institutional tail block', () => {
  const result = cleanMessageBody(
    [
      'The reference gas pressure should remain near 1 bar.',
      '',
      'Jane Example',
      'Laboratory Manager, Example University',
      'Tel: +1 555 123 4567',
      '[email redacted]',
    ].join('\n'),
  );
  assert.equal(result.text, 'The reference gas pressure should remain near 1 bar.');
  assert.ok(result.reasons.includes('institutional_signature_removed'));
});

test('removes long repeated signatures after a late valediction', () => {
  const result = cleanMessageBody(
    [
      'The reference gas pressure should remain near 1 bar.',
      '',
      'Best regards,',
      'Jane Example',
      'Laboratory Manager, Example University',
      'Tel: +1 555 123 4567',
      '[email redacted]',
      'This message is intended exclusively for its adressee.',
      'If received in error, please immediately notify the sender.',
    ].join('\n'),
  );
  assert.equal(result.text, 'The reference gas pressure should remain near 1 bar.');
  assert.ok(result.reasons.includes('institutional_signature_removed'));
});

test('removes common fragmented confidentiality boilerplate', () => {
  const result = cleanMessageBody(
    [
      'The MAT 253 signal is now stable.',
      'This message is intended exclusively for its adressee',
      'and may contain information that is CONFIDENTIAL and protected by professional privilege.',
      'Any dissemination, copy or disclosure is prohibited.',
    ].join('\n'),
  );
  assert.equal(result.text, 'The MAT 253 signal is now stable.');
  assert.ok(result.reasons.includes('boilerplate_removed'));
});

test('quarantines job posts even when they contain technical vocabulary', () => {
  const classification = classifyMessage(
    message({ subjectNormalized: 'Postdoc position in IRMS laboratory' }),
    'The laboratory operates a MAT 253 and GasBench.',
    true,
  );
  assert.equal(classification.searchable, false);
  assert.equal(classification.reasons[0], 'job_posting');
});

test('retains ambiguous content for recall instead of deleting it', () => {
  const classification = classifyMessage(
    message({ subjectNormalized: 'Question about nickel parts' }),
    'Could this be related?',
    false,
  );
  assert.equal(classification.searchable, true);
  assert.equal(classification.lane, 'review');
});

test('thread context rescues short technical replies', () => {
  const classification = classifyMessage(
    message({ subjectNormalized: 'Delta XL heater connection' }),
    'That fixed it, thank you.',
    true,
  );
  assert.equal(classification.searchable, true);
  assert.equal(classification.lane, 'searchable');
});

test('serialized records can be parsed again', () => {
  const source = `${serializeRecord(
    message(),
    'The heater connection measures 12 V and is now stable.',
  )}\n`;
  const parsed = parseMergedConversation(source);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].subjectNormalized, 'Delta XL heater connection');
  assert.match(parsed[0].cleanText, /12 V/);
});

test('phone masking does not consume vertical figure and table values', () => {
  const figureValues = ['188', '172', '165', '158', '142', '130', '128', '119'];
  const body = [
    'the Raw page (Figure 3-81 and Figure 3-82).',
    'Figure 3-81. Raw Page – Part I',
    ...figureValues,
    'Figure 3-82. Raw Page – Part II',
    'Table 3-27. Explanations for the Columns of the Result File',
    'Number Column Explanation',
    'Phone: +1 (555) 123-4567',
  ].join('\n');
  const source = `${serializeRecord(message(), body)}\n`;

  const [parsed] = parseMergedConversation(source);

  assert.ok(parsed);
  assert.match(parsed.cleanText, /Figure 3-81\. Raw Page – Part I/);
  assert.ok(parsed.cleanText.includes(figureValues.join('\n')));
  assert.match(parsed.cleanText, /Table 3-27\. Explanations/);
  assert.doesNotMatch(parsed.cleanText, /555/);
  assert.match(parsed.cleanText, /Phone: \[phone redacted\]/);
});
