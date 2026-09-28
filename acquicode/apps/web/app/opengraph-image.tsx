import { ImageResponse } from 'next/og';

export const alt = 'AcquiCode: evidence-graded technical diligence for AI-built software';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  const bar = (w: number, o: number) => <div style={{ width: w, height: 26, borderRadius: 13, background: `rgba(251,250,247,${o})`, marginBottom: 22 }} />;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#1f3a5f', color: '#fbfaf7', padding: 80, fontFamily: 'serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
          <div style={{ fontSize: 28, letterSpacing: 6, textTransform: 'uppercase', opacity: 0.75 }}>AcquiCode</div>
          <div style={{ fontSize: 64, lineHeight: 1.1, marginTop: 24, maxWidth: 760 }}>Know what a buyer will find in your code before they look.</div>
          <div style={{ fontSize: 28, marginTop: 28, opacity: 0.8, maxWidth: 760 }}>Evidence-graded technical diligence. Every claim tied to evidence. Every unknown stays unknown.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 260 }}>
          {bar(240, 1)}
          {bar(180, 0.72)}
          {bar(110, 0.42)}
        </div>
      </div>
    ),
    size,
  );
}
