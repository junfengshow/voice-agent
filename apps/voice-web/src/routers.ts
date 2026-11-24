// 主逻辑
// 集中配置 Web 页面路由，将根路径交给语音工作台。

import { createBrowserRouter } from 'react-router-dom';
import { VoiceWorkspace } from './pages/VoiceWorkspace';

export const router = createBrowserRouter([{ path: '/', Component: VoiceWorkspace }]);
