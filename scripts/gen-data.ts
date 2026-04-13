import { Generator } from '../src/data-generator/generator.js';

const gen = new Generator(12345);
gen.generateAndSave([1000000, 500000, 100000]);
