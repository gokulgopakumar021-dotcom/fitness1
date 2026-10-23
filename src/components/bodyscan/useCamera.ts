import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CameraController, type CameraNotice, type CameraState, type StartOptions } from '../../services/camera';

export interface UseCamera extends CameraState {
  /** Must be called from a user action (button click). */
  start: (options?: StartOptions) => Promise<void>;
  stop: (notice?: CameraNotice | null) => void;
  switchCamera: () => Promise<void>;
}

/**
 * React binding for CameraController.
 *
 * Releases the camera when the component unmounts, and also when the page is
 * hidden (tab switched, app backgrounded, page being navigated away), so the
 * camera is never left running where the person cannot see it.
 */
export function useCamera(): UseCamera {
  const [controller] = useState(() => new CameraController());
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);

  useEffect(() => {
    const stopIfActive = () => {
      const { status } = controller.getState();
      if (status === 'granted' || status === 'requesting') controller.stop('page_hidden');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopIfActive();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stopIfActive);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stopIfActive);
      controller.stop(); // unmount: release the camera and cancel any pending permission request
    };
  }, [controller]);

  const actions = useMemo(
    () => ({
      start: (options?: StartOptions) => controller.start(options),
      stop: (notice?: CameraNotice | null) => controller.stop(notice ?? null),
      switchCamera: () => controller.switchCamera(),
    }),
    [controller]
  );

  return { ...state, ...actions };
}
