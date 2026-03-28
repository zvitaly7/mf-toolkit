// Circular import test fixture — a → b → a
export { format } from 'date-fns';
export { something } from './circular-b';
