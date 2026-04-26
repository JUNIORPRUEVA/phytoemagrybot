import assert from 'node:assert/strict';
import test from 'node:test';
import { composeFinalMessage, selectBestResponse } from '../src/bot/response-composer';

test('composeFinalMessage collapses repeated lead phrases and duplicate sentences', () => {
  const input = 'Tranquilo... Perfecto... te explico. Te explico.';
  const output = composeFinalMessage(input);

  assert.match(output, /^Tranquilo\./);
  assert.match(output, /te explico\./i);
  assert.doesNotMatch(output, /te explico\.\s*Te explico\./);
});

test('composeFinalMessage enforces max 1 question and max 2 ideas', () => {
  const input = 'Te digo el precio? Quieres foto? Te explico el uso.';
  const output = composeFinalMessage(input);

  const questionCount = (output.match(/\?/g) ?? []).length;
  assert.equal(questionCount, 1);
  assert.match(output, /Te digo el precio\?/);
  assert.match(output, /Te explico el uso\./);
  assert.doesNotMatch(output, /Quieres foto\?/);
});

test('composeFinalMessage selects the first option when text looks like multiple list answers', () => {
  const input = '1) Te explico cómo funciona.\n2) Te paso el precio.\n3) Te mando una foto.';
  const output = composeFinalMessage(input);

  assert.equal(output, 'Te explico cómo funciona.');
});

test('composeFinalMessage preserves numbered steps when preceded by an intro line', () => {
  const input = [
    'Dale, te explico cómo se usa:',
    '1) Empieza con una taza al día',
    '2) Tómalo constante por varios días',
    '3) Acompáñalo con agua',
    '¿Quieres que te diga el precio también?',
  ].join('\n');

  const output = composeFinalMessage(input, { maxIdeas: 6, maxQuestions: 1 });

  assert.match(output, /cómo se usa/i);
  assert.match(output, /\n1\)/);
  assert.match(output, /\n2\)/);
  assert.match(output, /\n3\)/);
  assert.match(output, /\?$/);
});

test('composeFinalMessage preserves bullet explanations (does not collapse to first bullet)', () => {
  const input = [
    'Claro, te explico:',
    '- reduce el apetito',
    '- ayuda con liquidos retenidos',
    '- acelera el metabolismo',
    '¿Quieres que te diga el precio?',
  ].join('\n');

  const output = composeFinalMessage(input, { maxIdeas: 5, maxQuestions: 1 });

  assert.match(output, /reduce el apetito/i);
  assert.match(output, /acelera el metabolismo/i);
  assert.match(output, /\?$/);
  assert.match(output, /\n- /);
});

test('selectBestResponse prefers a clearer and shorter candidate', () => {
  const result = selectBestResponse([
    'Tranquilo... Perfecto... Perfecto... Te explico rapidito como funciona y te doy todos los detalles para que lo entiendas completo y luego vemos el precio y el pedido sin problema, dime por favor.',
    'Claro, te explico rápido y seguimos. ¿Te interesa más precio o resultados?',
    'Opción 1: Te explico.\nOpción 2: Te digo precio.\nOpción 3: Te mando foto.',
  ]);

  assert.equal(result.totalResponses, 3);
  assert.equal(result.selectedIndex, 1);
  assert.match(result.selectedText, /Claro, te explico rápido y seguimos\./);
});
