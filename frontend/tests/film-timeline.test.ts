import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_STEP,SCENES,SCENE_STARTS,TOTAL,advance,captionAt,clamp,formatTime,locate,sceneOpacity,span,startFromSearch} from '../src/components/film/timeline';

test('film runs 80 seconds over eight unique scenes',()=>{
  assert.equal(TOTAL,80);
  assert.equal(SCENES.length,8);
  assert.equal(new Set(SCENES.map(s=>s.id)).size,SCENES.length);
  assert.deepEqual(SCENE_STARTS,[0,6,17,28,38,51,63,73]);
});

test('locate maps global time to the scene and its local second',()=>{
  assert.deepEqual({...locate(0),scene:undefined},{index:0,scene:undefined,start:0,local:0});
  assert.equal(locate(5.99).scene.id,'intro');
  assert.equal(locate(6).scene.id,'problem');
  assert.equal(locate(6).local,0);
  assert.equal(locate(52.5).scene.id,'warning');
  assert.equal(Math.round(locate(52.5).local*10)/10,1.5);
  // The final frame stays on the last scene; out-of-range time is clamped.
  assert.equal(locate(TOTAL).scene.id,'outro');
  assert.equal(locate(TOTAL).local,SCENES.at(-1)!.duration);
  assert.equal(locate(-4).local,0);
  assert.equal(locate(999).scene.id,'outro');
});

test('captions are ordered, bilingual and inside their scene',()=>{
  for(const scene of SCENES){
    assert(scene.captions.length>0,scene.id);
    scene.captions.forEach((cue,i)=>{
      assert(cue.at>=0&&cue.at<scene.duration,`${scene.id} cue ${i}`);
      if(i)assert(cue.at>scene.captions[i-1].at,`${scene.id} order`);
      assert(cue.text.vi&&cue.text.en);
    });
  }
  const problem=SCENES[1];
  assert.equal(captionAt(problem,0),null);
  assert.equal(captionAt(problem,5),problem.captions[1]);
  assert.equal(captionAt(problem,10.9),problem.captions[2]);
});

test('easing helpers stay within 0..1 and respect the window',()=>{
  assert.equal(span(1,2,3),0);
  assert.equal(span(4,2,3),1);
  assert.equal(span(2.5,2,3,p=>p),0.5);
  assert.equal(span(5,5,5),1);
  assert.equal(clamp(2),1);
  assert.equal(sceneOpacity(0,6),0);
  assert.equal(sceneOpacity(3,6),1);
  assert.equal(sceneOpacity(6,6),0);
});

test('advance clamps long frames and stops at the end',()=>{
  assert.deepEqual(advance(10,0.016),{time:10.016,ended:false});
  // A tab that was hidden for minutes resumes one step later instead of skipping scenes.
  assert.deepEqual(advance(10,300),{time:10+MAX_STEP,ended:false});
  assert.deepEqual(advance(10,-1),{time:10,ended:false});
  assert.deepEqual(advance(79.95,0.1),{time:TOTAL,ended:true});
});

test('time labels and the ?t= start parameter',()=>{
  assert.equal(formatTime(0),'0:00');
  assert.equal(formatTime(65.9),'1:05');
  assert.equal(formatTime(500),'1:20');
  assert.equal(startFromSearch('?t=42'),42);
  assert.equal(startFromSearch('?t=12.5&clean=1'),12.5);
  assert.equal(startFromSearch('?t=999'),TOTAL);
  assert.equal(startFromSearch('?t=abc'),null);
  assert.equal(startFromSearch('?t='),null);
  assert.equal(startFromSearch(''),null);
});
