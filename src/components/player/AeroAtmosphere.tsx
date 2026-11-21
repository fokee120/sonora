import { memo } from 'react';

export const AeroAtmosphere = memo(function AeroAtmosphere({ mode }: { mode: 'expanded' | 'fullscreen' }) {
  return <div className={'aero-atmosphere aero-atmosphere-' + mode} aria-hidden="true">
    <i className="aero-current"/>
    <i className="aero-bubble"/>
    <i className="aero-bubble"/>
    {mode === 'fullscreen' && <i className="aero-bubble"/>}
  </div>;
});
