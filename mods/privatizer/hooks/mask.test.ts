import { expect, test } from 'claude-code/testing'

import { BAR, isIban, isLuhn, isPesel, mask } from './mask.ts'

const hidden = (s: string) => mask(s) !== s
const gone = (s: string, part: string) => !mask(s).includes(part)

test('checksums', async () => {
  expect(isPesel('44051401359')).toBe(true)
  expect(isPesel('44051401358')).toBe(false)
  expect(isIban('PL61 1090 1014 0000 0712 1981 2874')).toBe(true)
  expect(isIban('PL61 1090 1014 0000 0712 1981 2875')).toBe(false)
  expect(isIban('DE89 3704 0044 0532 0130 00')).toBe(true)
  expect(isLuhn('4111 1111 1111 1111')).toBe(true)
  expect(isLuhn('4111 1111 1111 1112')).toBe(false)
})

test('Polish and EU data is hidden', async () => {
  expect(gone('PESEL: 44051401359.', '44051401359')).toBe(true)
  expect(gone('Konto PL61 1090 1014 0000 0712 1981 2874 w banku', '1981')).toBe(true)
  expect(gone('Konto 61 1090 1014 0000 0712 1981 2874 w banku', '1981')).toBe(true)
  expect(gone('IBAN DE89 3704 0044 0532 0130 00', '3704')).toBe(true)
  expect(gone('Karta 4111 1111 1111 1111 ważna', '4111')).toBe(true)
  expect(gone('Zadzwoń 600 123 456 jutro', '600 123 456')).toBe(true)
  expect(gone('Zadzwoń 600-123-456', '123-456')).toBe(true)
  expect(gone('Zadzwoń 600123456', '600123456')).toBe(true)
  expect(gone('Tel. +48 600 123 456', '600')).toBe(true)
  expect(gone('Biuro 22 123 45 67', '123 45 67')).toBe(true)
  expect(gone('Rata 1 500 zł miesięcznie', '1 500')).toBe(true)
  expect(gone('Kwota 4 500,00 PLN', '4 500')).toBe(true)
  expect(gone('Cena 1.234,56 €', '1.234')).toBe(true)
  expect(gone('PLN 12 000 brutto', '12 000')).toBe(true)
  expect(gone('Koszt $1,250.00', '1,250')).toBe(true)
  expect(gone('pisz na anna.kowalska@example.pl', 'anna.kowalska')).toBe(true)
})

test('secrets are hidden', async () => {
  expect(gone('key sk-ant-api03-abcdefghijklmnopqrstuvwx', 'abcdefghij')).toBe(true)
  expect(gone('ghp_abcdefghijklmnopqrstuvwxyz0123', 'ghp_')).toBe(true)
  expect(gone('Authorization: Bearer abcdef1234567890xyz', 'abcdef1234')).toBe(true)
  expect(gone('password=hunter2secret', 'hunter2')).toBe(true)
  expect(gone('"api_key": "zzz-123-abc-999"', 'zzz-123')).toBe(true)
  expect(mask('password=hunter2secret')).toBe(`password=${BAR}`)
})

test('names and ordinary numbers stay', async () => {
  for (const s of [
    'Rozmawiałem z Anną Kowalską i Janem Nowakiem',
    'From: Jane Doe',
    'Released 2024-05-12, version 1.2.3',
    'Context 182k tokens, 1500 words',
    'timestamp 1731330000000',
    'open /Users/me/notes/file-600123456.md',
    'PESEL-like 44051401358 is invalid',
    'card-like 4111 1111 1111 1112 is invalid',
    'MAX_TOKENS=8000 and password=$PASSWORD',
    'see https://example.com/item/600123456?id=4111111111111111',
  ]) {
    expect(mask(s)).toBe(s)
  }
})

test('bars are fixed width', async () => {
  const short = mask('a@b.co')
  const long = mask('anna.maria.kowalska-nowak@example-company.pl')
  expect(short).toBe(BAR)
  expect(long).toBe(BAR)
})

test('nothing private: same string back', async () => {
  const s = 'Plain text with no data.'
  expect(mask(s)).toBe(s)
  expect(hidden(s)).toBe(false)
})

test('review fixes: leaks closed', async () => {
  const nb = ' '
  expect(mask('IBAN PL61 1090 1014 0000 0712 1981 2874 BIC BPKOPLPW').includes('1090')).toBe(false)
  expect(mask('IBAN PL61 1090 1014 0000 0712 1981 2874 BIC BPKOPLPW')).toContain('BIC BPKOPLPW')
  expect(gone(`Rata 1${nb}500 zł`, '500')).toBe(true)
  expect(gone(`Tel. 600${nb}123${nb}456`, '123')).toBe(true)
  expect(gone('Kwota 5 tys. zł', '5 tys')).toBe(true)
  expect(gone('Kwota 1,5 tys. zł', '1,5')).toBe(true)
  expect(gone('Kwota 20 tys. złotych', '20')).toBe(true)
  expect(gone('phone=+48600123456', '600123456')).toBe(true)
  expect(gone('tel=600 123 456', '123 456')).toBe(true)
  expect(gone('tel. 600123456', '600123456')).toBe(true)
  expect(gone('Tel 600 12 34 56', '12 34 56')).toBe(true)
  expect(gone('{"password":"my secret pass"}', 'secret pass')).toBe(true)
  expect(gone('password=abc,def123', 'abc,def')).toBe(true)
  expect(gone('hasło: Tajne123!', 'Tajne')).toBe(true)
  expect(gone('Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpw')).toBe(true)
})

test('review fixes: no false alarms', async () => {
  for (const s of [
    "awk '{print $10}'",
    'echo $12',
    'bypass=enabled',
    'PWD=/Users/me',
    '684123456 bytes',
    'Total: 512345678 tokens',
    'build 0000123456',
  ]) {
    expect(mask(s)).toBe(s)
  }
})

test('the money samples typed in chat, each on its own line', () => {
  const text = '768 321 321\n\n1000pln\n10zł\n2$\n25€\n\n1000 pln\n10 zł\n2 $\n25 €'
  const out = mask(text)
  for (const s of ['768', '1000', '10', '2', '25', 'pln', 'zł', '$', '€']) expect(out.includes(s)).toBe(false)
  // One bar per line: nothing joins across a line break.
  expect(out).toBe([BAR, '', BAR, BAR, BAR, BAR, '', BAR, BAR, BAR, BAR].join('\n'))
})

test('a dollar sign on one line never takes the number on the next', () => {
  expect(mask('cost $\n25 apples')).toBe('cost $\n25 apples')
})

test('shell and regex dollars stay', () => {
  for (const s of ['echo 1 $HOME', "awk '{print $10}'", 'grep -E "^v2$"']) expect(mask(s)).toBe(s)
})
