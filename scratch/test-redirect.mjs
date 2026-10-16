import { searchImageProvider } from '../lib/image-providers.ts';

const url1 = 'https://upload.wikimedia.org/wikipedia/commons/7/73/Kidney-numbered.png';
const res1 = await fetch(url1, { redirect: 'error', headers: { 'User-Agent': 'Chalkie/2.0' } }).catch(e => e);
console.log('url1 result:', res1.status || res1.message);

const found = await searchImageProvider('commons', 'kidney anatomy');
console.log('Found', found.length, 'images. First url:', found[0]?.url);
if (found[0]) {
  const res2 = await fetch(found[0].url, { redirect: 'error', headers: { 'User-Agent': 'Chalkie/2.0' } }).catch(e => e);
  console.log('found[0] with redirect error:', res2.status || res2.message);
  const res3 = await fetch(found[0].url, { redirect: 'follow', headers: { 'User-Agent': 'Chalkie/2.0' } }).catch(e => e);
  console.log('found[0] with redirect follow:', res3.status || res3.message);
}

const foundOpenverse = await searchImageProvider('openverse', 'kidney anatomy');
console.log('Found openverse', foundOpenverse.length, 'images. First url:', foundOpenverse[0]?.url);
if (foundOpenverse[0]) {
  const res4 = await fetch(foundOpenverse[0].url, { redirect: 'error', headers: { 'User-Agent': 'Chalkie/2.0' } }).catch(e => e);
  console.log('openverse[0] with redirect error:', res4.status || res4.message);
  const res5 = await fetch(foundOpenverse[0].url, { redirect: 'follow', headers: { 'User-Agent': 'Chalkie/2.0' } }).catch(e => e);
  console.log('openverse[0] with redirect follow:', res5.status || res5.message);
}
