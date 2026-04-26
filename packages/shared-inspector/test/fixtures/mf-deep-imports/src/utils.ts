// Same deep specifier (lodash/get) imported from a second file.
// Aggregator must dedupe specifiers within a package.
import get from 'lodash/get';
import { format } from 'date-fns';
import addDays from 'date-fns/addDays';

export { get, format, addDays };
