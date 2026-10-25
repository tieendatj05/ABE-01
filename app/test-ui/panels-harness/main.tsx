import '../../web/src/styles.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelCanLamSang, PanelHanhChinh, PanelKetLuan, PanelLamSang } from '../../web/src/Sections.js';
import { LAM_SANG, MAU_NHANH } from '../../web/src/data/catalog.js';
import { blank } from '../../web/src/model.js';

function H() {
  const [hc, setHc] = useState(blank.hanhchinh());
  const [cls, setCls] = useState(blank.canlamsang());
  const [kl, setKl] = useState(blank.ketluan());
  const [ls, setLs] = useState<Record<string, any>>(Object.fromEntries(LAM_SANG.map((k) => [k.khoa, MAU_NHANH['Bình thường'](k.muc)])));
  (window as any).state = { hc, cls, kl, ls };
  return <div style={{ padding: 12, maxWidth: 1200 }}>
    <PanelHanhChinh d={hc} set={setHc} off={false} child={false} lockCccd={false} />
    <PanelLamSang ls={ls} setLs={(k, v) => setLs({ ...ls, [k]: v })} can={() => true} denied={{}} child meta={{}} onNormal={() => {}} onClear={() => {}} onLoad={(n) => setLs(Object.fromEntries(LAM_SANG.map((k) => [k.khoa, MAU_NHANH[n](k.muc)])))} />
    <PanelCanLamSang d={cls} set={setCls} off={false} sex="nam" child />
    <PanelKetLuan d={kl} set={setKl} off={false} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<H />);
