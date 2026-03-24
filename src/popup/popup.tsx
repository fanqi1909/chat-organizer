import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getSettings, saveSettings } from '../shared/storage'

const styles = `
  .container { padding: 16px; }
  h1 { font-size: 16px; color: #a78bfa; margin-bottom: 16px; font-weight: 700; }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid #2d2d4e;
  }
  .label { color: #e2e8f0; }
  .sub { color: #64748b; font-size: 11px; margin-top: 2px; }
  /* Toggle switch */
  .toggle { position: relative; width: 40px; height: 22px; }
  .toggle input { display: none; }
  .slider {
    position: absolute; inset: 0;
    background: #2d2d4e;
    border-radius: 22px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .slider::before {
    content: '';
    position: absolute;
    width: 16px; height: 16px;
    background: white;
    border-radius: 50%;
    left: 3px; top: 3px;
    transition: transform 0.2s;
  }
  input:checked + .slider { background: #7c3aed; }
  input:checked + .slider::before { transform: translateX(18px); }
  .status {
    margin-top: 16px;
    padding: 8px;
    border-radius: 6px;
    font-size: 12px;
    text-align: center;
  }
  .status.ok { background: #14532d; color: #86efac; }
  .status.warn { background: #78350f; color: #fcd34d; }
`

function Popup() {
  const [enabled, setEnabled] = useState(true)
  const [sessionOk, setSessionOk] = useState<boolean | null>(null)

  useEffect(() => {
    getSettings().then((s) => setEnabled(s.threadingEnabled))
    checkSession()
  }, [])

  async function checkSession() {
    try {
      const cookie = await chrome.cookies.get({
        url: 'https://claude.ai',
        name: '__Secure-next-auth.session-token',
      })
      setSessionOk(!!cookie)
    } catch {
      setSessionOk(false)
    }
  }

  async function handleToggle(checked: boolean) {
    setEnabled(checked)
    await saveSettings({ threadingEnabled: checked })
  }

  return (
    <>
      <style>{styles}</style>
      <div className="container">
        <h1>Thread Plugin</h1>

        <div className="row">
          <div>
            <div className="label">Auto Threading</div>
            <div className="sub">Detect topic changes automatically</div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => handleToggle(e.target.checked)}
            />
            <span className="slider" />
          </label>
        </div>

        {sessionOk !== null && (
          <div className={`status ${sessionOk ? 'ok' : 'warn'}`}>
            {sessionOk
              ? 'Logged in to Claude — ready to use'
              : 'Not logged in to Claude. Please open claude.ai and sign in.'}
          </div>
        )}
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(React.createElement(Popup))
