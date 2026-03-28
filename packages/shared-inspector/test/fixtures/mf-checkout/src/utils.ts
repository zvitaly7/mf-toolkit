import get from 'lodash/get';
import { format } from 'date-fns';

export function getNestedValue(obj: object, path: string) {
  return get(obj, path);
}

export function formatDate(date: Date): string {
  return format(date, 'dd.MM.yyyy');
}
