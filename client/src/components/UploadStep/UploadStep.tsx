import { useState, useRef } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import axios from 'axios';
import {
  FileText, Archive, BarChart2, Zap, Upload, CheckCircle, Loader, AlertCircle,
} from 'lucide-react';
import { useStudyStore } from '../../store/useStudyStore';
import type { StudyMetadata } from '../../types/study';
import styles from './UploadStep.module.css';

interface FileSlot {
  key: 'xml' | 'signalZip' | 'interferenceZip' | 'statsZip' | 'statsInterferenceZip';
  label: string;
  accept: string;
  description: string;
  icon: React.ReactNode;
  required: boolean;
}

const FILE_SLOTS: FileSlot[] = [
  {
    key: 'xml',
    label: 'XML del Estudio',
    accept: '.xml',
    description: 'Archivo de configuración del estudio XIRIO con sectores y rangos de color',
    icon: <FileText size={24} />,
    required: true,
  },
  {
    key: 'signalZip',
    label: 'ZIP de Señal',
    accept: '.zip',
    description: 'Contiene cov-*.tif (señal), bs-*.tif (mejor servidor), ol-*.tif (solapamiento)',
    icon: <Zap size={24} />,
    required: true,
  },
  {
    key: 'interferenceZip',
    label: 'ZIP de Interferencia',
    accept: '.zip',
    description: 'GeoTIFFs de RSSI, SS-RSRQ, DL/UL-SINR y Throughput teórico',
    icon: <BarChart2 size={24} />,
    required: false,
  },
  {
    key: 'statsZip',
    label: 'ZIP de Estadísticas de Señal',
    accept: '.zip',
    description: 'Archivos CSV con estadísticas de señal y mejor servidor por capa',
    icon: <Archive size={24} />,
    required: false,
  },
  {
    key: 'statsInterferenceZip',
    label: 'ZIP de Estadísticas de Interferencia',
    accept: '.zip',
    description: 'Archivos CSV con estadísticas de RSSI, SINR y Throughput por capa',
    icon: <Archive size={24} />,
    required: false,
  },
];

export function UploadStep() {
  const { setMetadata, setStep, setUploading, setError, isUploading, uploadProgress, error } =
    useStudyStore();

  const [files, setFiles] = useState<Partial<Record<FileSlot['key'], File>>>({});
  const [dragOver, setDragOver] = useState<FileSlot['key'] | null>(null);
  const inputRefs = useRef<Partial<Record<FileSlot['key'], HTMLInputElement>>>({});

  function handleFileSelect(key: FileSlot['key'], file: File) {
    setFiles((prev) => ({ ...prev, [key]: file }));
  }

  function handleDrop(key: FileSlot['key'], e: DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(key, file);
  }

  function handleInputChange(key: FileSlot['key'], e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(key, file);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleSubmit() {
    if (!files.xml) {
      setError('El archivo XML del estudio es obligatorio');
      return;
    }
    if (!files.signalZip) {
      setError('El archivo ZIP de señal es obligatorio');
      return;
    }

    setError(null);
    setUploading(true, 0);

    const formData = new FormData();
    formData.append('xml', files.xml);
    formData.append('signalZip', files.signalZip);
    if (files.interferenceZip) formData.append('interferenceZip', files.interferenceZip);
    if (files.statsZip) formData.append('statsZip', files.statsZip);
    if (files.statsInterferenceZip) formData.append('statsInterferenceZip', files.statsInterferenceZip);

    try {
      const response = await axios.post<StudyMetadata>('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
          setUploading(true, pct);
        },
      });

      setMetadata(response.data);
      setUploading(false);
      setStep('config');
    } catch (err: any) {
      setUploading(false);
      const msg =
        err.response?.data?.details ||
        err.response?.data?.error ||
        'Error al procesar los archivos. Revisa los archivos e inténtalo de nuevo.';
      setError(msg);
    }
  }

  const canSubmit = !isUploading && Boolean(files.xml) && Boolean(files.signalZip);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="7" fill="#6b1874" />
            <path d="M8 24L16 8L24 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M11 19H21" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className={styles.logoText}>XIRIO <span>Informes</span></span>
        </div>
        <p className={styles.subtitle}>
          Genera informes PDF profesionales a partir de exportaciones de XIRIO Online
        </p>
      </div>

      <div className={styles.slots}>
        {FILE_SLOTS.map((slot) => {
          const file = files[slot.key];
          const isDragTarget = dragOver === slot.key;

          return (
            <div
              key={slot.key}
              className={`${styles.slot} ${isDragTarget ? styles.dragOver : ''} ${file ? styles.hasFile : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(slot.key); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(slot.key, e)}
              onClick={() => inputRefs.current[slot.key]?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && inputRefs.current[slot.key]?.click()}
            >
              <input
                ref={(el) => { if (el) inputRefs.current[slot.key] = el; }}
                type="file"
                accept={slot.accept}
                style={{ display: 'none' }}
                onChange={(e) => handleInputChange(slot.key, e)}
              />

              <div className={styles.slotIcon}>
                {file ? <CheckCircle size={24} color="#10b981" /> : slot.icon}
              </div>

              <div className={styles.slotContent}>
                <div className={styles.slotLabel}>
                  {slot.label}
                  {slot.required && <span className={styles.required}>*</span>}
                </div>
                {file ? (
                  <div className={styles.fileName}>
                    {file.name}
                    <span className={styles.fileSize}>{formatSize(file.size)}</span>
                  </div>
                ) : (
                  <div className={styles.slotDesc}>{slot.description}</div>
                )}
              </div>

              <div className={styles.slotAction}>
                {file ? (
                  <span className={styles.changeBtn}>Cambiar</span>
                ) : (
                  <Upload size={16} className={styles.uploadIcon} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {isUploading && (
        <div className={styles.progressContainer}>
          <div className={styles.progressLabel}>
            <Loader size={14} className="animate-spin" />
            <span>
              {uploadProgress < 100
                ? `Subiendo archivos... ${uploadProgress}%`
                : 'Procesando datos del estudio...'}
            </span>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <p className={styles.required_note}>* Archivos obligatorios</p>
        <button
          className={styles.submitBtn}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {isUploading ? (
            <>
              <Loader size={16} className="animate-spin" />
              Procesando...
            </>
          ) : (
            <>
              <Upload size={16} />
              Procesar archivos
            </>
          )}
        </button>
      </div>
    </div>
  );
}
