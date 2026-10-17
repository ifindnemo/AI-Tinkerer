import test from 'node:test';
import assert from 'node:assert/strict';
import {SLIDES,TOTAL_SECONDS,clampSlide,clock,remaining,slideFromHash,slideStarts} from '../src/components/present/deck';

test('the talk has five slides that add up to seven minutes, the demo being the longest',()=>{
  assert.deepEqual(SLIDES.map(s=>s.seconds),[40,160,100,90,30]);
  assert.equal(TOTAL_SECONDS,420);
  assert.equal(new Set(SLIDES.map(s=>s.id)).size,5);
  assert.equal(Math.max(...SLIDES.map(s=>s.seconds)),SLIDES.find(s=>s.id==='demo')!.seconds);
  assert.deepEqual(slideStarts(),[0,40,200,300,390]);
});

test('slide numbers and the address hash are clamped',()=>{
  assert.equal(clampSlide(-3),0);
  assert.equal(clampSlide(99),4);
  assert.equal(clampSlide(NaN),0);
  assert.equal(clampSlide(2.9),2);
  assert.equal(slideFromHash('#3'),2);
  assert.equal(slideFromHash('#9'),4);
  assert.equal(slideFromHash('#0'),0);
  assert.equal(slideFromHash(''),0);
  assert.equal(slideFromHash('#demo'),0);
});

test('the timer reads minutes and seconds and reports time left in the current slide',()=>{
  assert.equal(clock(0),'0:00');
  assert.equal(clock(65),'1:05');
  assert.equal(clock(420),'7:00');
  assert.equal(clock(-4),'0:00');
  assert.equal(clock(NaN),'0:00');
  assert.equal(remaining(10,0),30);
  assert.equal(remaining(45,0),-5);
  assert.equal(remaining(60,1),140);
  assert.equal(remaining(430,4),-10);
});
