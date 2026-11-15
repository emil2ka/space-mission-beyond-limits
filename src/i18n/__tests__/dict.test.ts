import { describe, expect, it } from 'vitest';
import { EN, PART_LIST, RU } from '../dict';
import { render } from '../format';
import { tIn } from '..';

describe('i18n dictionaries', () => {
  it('ru and en have identical key sets in every fragment', () => {
    for (const [name, p] of Object.entries(PART_LIST)) {
      expect(Object.keys(p.en).sort(), name).toEqual(Object.keys(p.ru).sort());
    }
    expect(Object.keys(EN).sort()).toEqual(Object.keys(RU).sort());
  });
  it('no key is defined in two fragments', () => {
    const total = Object.values(PART_LIST).reduce((s, p) => s + Object.keys(p.ru).length, 0);
    expect(Object.keys(RU).length).toBe(total);
  });
  it('t interpolates params, plurals and nested messages', () => {
    const d = { a: 'Осталось {n} {n|минута|минуты|минут} у {who}', b: '{x}!' };
    expect(render('ru', d, { k: 'a', p: { n: 1, who: 'Али' } })).toBe('Осталось 1 минута у Али');
    expect(render('ru', d, { k: 'a', p: { n: 3, who: 'Али' } })).toBe('Осталось 3 минуты у Али');
    expect(render('ru', d, { k: 'a', p: { n: 11, who: 'Али' } })).toBe('Осталось 11 минут у Али');
    expect(render('ru', d, { k: 'b', p: { x: { k: 'a', p: { n: 2, who: 'X' } } } })).toBe('Осталось 2 минуты у X!');
    expect(render('en', { a: '{n} {n|minute|minutes}' }, { k: 'a', p: { n: 1 } })).toBe('1 minute');
    expect(tIn('en', 'unit.min', { n: 5 })).toBe('5 min');
    expect(tIn('ru', 'role.engineer')).toBe('Главный инженер');
    expect(tIn('en', 'role.engineer')).toBe('Chief Engineer');
  });
  it('English dictionary has no Cyrillic outside the language switch', () => {
    const bad = Object.entries(EN).filter(([k, v]) => /[А-Яа-яЁё]/.test(v) && !k.startsWith('lang.'));
    expect(bad).toEqual([]);
  });
});
