import test from 'node:test';
import assert from 'node:assert/strict';
import type {AgentReply,MaintenanceRecord} from '../src/lib/backend/contract';
import {historyInsight,toolSteps,topicsOf} from '../src/lib/backend/tool-insights';
const records:MaintenanceRecord[]=[
 {record_id:'a',date:'2025-03-21',garage:'Garage Thành Phát',fault_code:1,fault_label:'Cảnh báo - Hỗn hợp nhiên liệu nghèo (Lean Mixture)',diagnosis:'Lambda và AFR lệch cao',status:'resolved'},
 {record_id:'b',date:'2025-05-10',garage:'Garage Minh Quân',fault_code:0,fault_label:'Không phát hiện lỗi',diagnosis:'Các chỉ số bình thường'},
 {record_id:'c',date:'2026-03-04',garage:'Garage Thành Phát',fault_code:3,fault_label:'Nghiêm trọng - Nghi bỏ máy (Possible Misfire)',diagnosis:'cần kiểm tra hệ thống đánh lửa',status:'resolved'},
];
const reply=(over:Partial<AgentReply['assessment']>,trace:AgentReply['tool_trace']=[{tool:'get_maintenance_history',result:{total_records:records.length,records}}]):AgentReply=>({status:'normal',vehicle_id:'bmw-m2',batch_id:'b1',accepted_records:15,assessment:{severity:'warning',diagnosis:'',suspected_faults:[],evidence:[],confidence:.7,missing_data:[],recommendations:['x'],...over},hard_safety_guardrail:{triggered:false,minimum_severity:'normal',reasons:[]},tool_trace:trace,memory:null,sanitization:{removed_fields:['fault'],removed_values:0}});

test('topics recognise cooling and mixture faults in Vietnamese and English',()=>{
 assert.deepEqual(topicsOf('Nghi quạt làm mát không hoạt động'),['cooling']);
 assert.deepEqual(topicsOf('Possible lean mixture'),['lean']);
 assert.deepEqual(topicsOf('Bỏ máy xi-lanh 2'),['misfire']);
});
test('history card reports a similar earlier fault with date and garage',()=>{
 const h=historyInsight(reply({suspected_faults:['Hệ thống đánh lửa gây bỏ máy']}))!;
 assert.equal(h.similar.length,1);assert.equal(h.similar[0].record_id,'c');
 assert.equal(h.last?.record_id,'c');assert.deepEqual(h.regularGarage,{name:'Garage Thành Phát',visits:2});
});
test('overheating does not match unrelated mixture/misfire history, and quoted history in evidence never self-matches',()=>{
 const h=historyInsight(reply({suspected_faults:['Quạt làm mát hoặc van hằng nhiệt'],evidence:['Lịch sử: từng lỗi hỗn hợp nghèo năm 2025']}))!;
 assert.equal(h.similar.length,0);assert.equal(h.total,3);
});
test('normal results never claim a similar issue; missing or failed tool yields no card',()=>{
 assert.equal(historyInsight(reply({severity:'normal',suspected_faults:['bỏ máy']}))!.similar.length,0);
 assert.equal(historyInsight(reply({},[])),null);
 assert.equal(historyInsight(reply({},[{tool:'get_maintenance_history',result:{error:'Dịch vụ chưa trả được dữ liệu.'}}])),null);
});
test('tool trace starts with the backend guardrail, keeps call order, flags failures and ends with the verdict',()=>{
 const steps=toolSteps(reply({severity:'critical',confidence:.82},[
  {tool:'get_external_environment_context',result:{success:true,data:{outside_temperature_c:31,observed_at:'2026-10-03T04:00:00Z',latitude:10.8,longitude:106.7,weather_grid_distance_km:1.2}}},
  {tool:'get_maintenance_history',result:{total_records:3,records}},
  {tool:'search_nearby_garages',result:{error:'Dịch vụ chưa trả được dữ liệu.'}},
 ]));
 assert.deepEqual(steps.map(s=>s.kind),['guardrail','weather','history','garages','verdict']);
 assert.deepEqual(steps[1],{kind:'weather',ok:true,temperature:31,gridKm:1.2});
 assert.deepEqual(steps[2],{kind:'history',ok:true,total:3,lastDate:'2026-03-04'});
 assert.equal((steps[3] as {ok:boolean}).ok,false);
 assert.deepEqual(steps[4],{kind:'verdict',severity:'critical',confidence:.82});
});
