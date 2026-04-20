import { useStudyStore } from './store/useStudyStore';
import { UploadStep } from './components/UploadStep/UploadStep';
import { ConfigStep } from './components/ConfigStep/ConfigStep';
import { ReportPage } from './report/ReportPage';
import './App.css';

const isReportPage = window.location.pathname === '/report';

function AppWizard() {
  const { step } = useStudyStore();

  return (
    <div className="app-container">
      <StepsIndicator />
      <main className="app-main">
        {step === 'upload' && <UploadStep />}
        {(step === 'config' || step === 'preview') && <ConfigStep />}
      </main>
    </div>
  );
}

function StepsIndicator() {
  const { step } = useStudyStore();

  const steps = [
    { key: 'upload', label: 'Cargar archivos', num: 1 },
    { key: 'config', label: 'Configurar y generar', num: 2 },
  ];

  const currentIdx = steps.findIndex(
    (s) => s.key === step || (s.key === 'config' && step === 'preview')
  );

  return (
    <div className="steps-bar">
      {/* Logo */}
      <div className="steps-logo">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="7" fill="#6b1874" />
          <path d="M8 24L16 8L24 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11 19H21" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="steps-brand">XIRIO <span>Informes</span></span>
      </div>

      <div className="steps-divider" />

      {/* Pasos */}
      <div className="steps-list">
        {steps.map((s, idx) => {
          const isActive = idx === currentIdx;
          const isDone = idx < currentIdx;

          return (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
              <div className={`step-item ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
                <div className="step-num">
                  {isDone ? '✓' : s.num}
                </div>
                <span className="step-label">{s.label}</span>
              </div>
              {idx < steps.length - 1 && (
                <span className="step-arrow">›</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Espacio derecho vacío para balance */}
      <div style={{ width: 180 }} />
    </div>
  );
}

export default function App() {
  if (isReportPage) return <ReportPage />;
  return <AppWizard />;
}
