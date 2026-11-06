import { assert, test } from 'poku';
import { add } from '../src/placeholder.ts';

await test('add combines two numbers', () => {
  assert.strictEqual(add(2, 3), 5);
});
