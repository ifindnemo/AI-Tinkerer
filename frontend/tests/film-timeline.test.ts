import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAPTERS,TOTAL,chapterAt,clampTime,formatTime,startFromSearch} from '../src/components/film/timeline';

test('90-second MP4 chapters are ordered, bilingual and include driver camera and privacy',()=>{
  assert.equal(TOTAL,90);
  assert.equal(CHAPTERS.length,8);
  assert.equal(new Set(CHAPTERS.map(c=>c.id)).size,8);
  assert.equal(CHAPTERS[0].start,0);
  for (let i=0;i<CHAPTERS.length;i++) {
    const c=CHAPTERS[i];
    assert(c.start<TOTAL);
    if(i) assert(c.start>CHAPTERS[i-1].start);
    assert(c.title.vi && c.title.en && c.description.vi && c.description.en);
  }
  assert.equal(CHAPTERS[chapterAt(60)].id,'camera');
  assert.equal(CHAPTERS[chapterAt(80)].id,'privacy');
  assert.equal(CHAPTERS[chapterAt(90)].id,'closing');
  assert.equal(chapterAt(-5),0);
  assert.equal(chapterAt(NaN),0);
  for(let i=1;i<CHAPTERS.length;i++) {
    assert.equal(chapterAt(CHAPTERS[i].start-.01),i-1);
    assert.equal(chapterAt(CHAPTERS[i].start),i);
  }
});

test('seek links clamp to the actual film and reject malformed or nonfinite values',()=>{
  assert.equal(startFromSearch('?t=62.5&clean=1'),62.5);
  assert.equal(startFromSearch('?t=999'),90);
  assert.equal(startFromSearch('?t=-10'),0);
  for(const query of ['', '?t=', '?t=abc', '?t=Infinity', '?t=NaN']) assert.equal(startFromSearch(query),null);
  assert.equal(clampTime(Infinity),0);
  assert.equal(formatTime(65.9),'1:05');
  assert.equal(formatTime(500),'1:30');
});
