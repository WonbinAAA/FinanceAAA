import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,formatCalculation} from '../public/calculator.js';

test('calculator keeps exact decimals, precedence and division until rounding the applied amount',()=>{
 for(const [expression,expected] of [
  ['0.1+0.2','0.3'],['2+3×4','14'],['(2+3)*4','20'],
  ['10÷3×3','10'],['.5+-.2','0.3'],['-7+2','-5'],['1.005','1.01'],
 ]){
  assert.equal(formatCalculation(calculate(expression),2),expected,expression);
 }
 for(const expression of ['1/0','1+','2(3)','abc','(1+2','1..2']){
  assert.throws(()=>calculate(expression),undefined,expression);
 }
});
