import React from 'react';
import Sidebar from './components/Sidebar';
import Viewer from './components/Viewer';

function App() {
  return (
    <div className="app-container">
      <Sidebar />
      <Viewer />
    </div>
  );
}

export default App;
