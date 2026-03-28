import React from 'react';
import { observer } from './shared';
import { useNavigate } from 'react-router-dom';
// import type is excluded from analysis
import type { FC } from 'react';

const App: FC = observer(() => {
  const navigate = useNavigate();
  return <div onClick={() => navigate('/')}>App</div>;
});

export default App;
