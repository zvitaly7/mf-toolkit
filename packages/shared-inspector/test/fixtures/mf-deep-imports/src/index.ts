// Mix of root + deep imports of the same package — both must be reported.
import { useState } from 'react';
import jsx from 'react/jsx-runtime';

// Three distinct deep imports of the same package across this file.
import get from 'lodash/get';
import set from 'lodash/set';
import cloneDeep from 'lodash/cloneDeep';

// Scoped package deep import (`@scope/pkg/sub`).
import Button from '@mui/material/Button';

// CommonJS require with a deep specifier.
const debounce = require('lodash/debounce');

// Dynamic import with a literal deep specifier.
async function load() {
  return import('rxjs/operators');
}

export { useState, jsx, get, set, cloneDeep, Button, debounce, load };
