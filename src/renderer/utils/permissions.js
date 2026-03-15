/**
 * Permission utility for checking and requesting system permissions
 */
import { addLog } from './logger.js';

export const permissionUtil = {
    async check(type) {
        try {
            if (type === 'screen') {
                const status = await window.recorderAPI.checkScreenPermission();
                const granted = status === 'granted';
                return { granted, status };
            }

            if (type === 'mic') {
                const status = await window.recorderAPI.checkMicPermission();
                return { granted: status === 'granted', status };
            }
        } catch (error) {
            console.error(`Permission check error for ${type}:`, error);
            return { granted: false, status: 'error', message: error.message };
        }

        return { granted: false, status: 'unsupported' };
    },

    async request(type) {
        try {
            if (type === 'screen') {
                // Use Capture SDK for screen permission
                await window.recorderAPI.requestPermission('screen-capture');
                // Check status after request
                return await this.check(type);
            }

            if (type === 'mic') {
                const result = await window.recorderAPI.requestMicPermission();
                return result;
            }
        } catch (error) {
            console.error(`Permission request error for ${type}:`, error);
            return { granted: false, status: 'error', message: error.message };
        }

        return { granted: false, status: 'unsupported' };
    },

    async ensure(type) {
        const checkResult = await this.check(type);
        if (checkResult.granted) return true;

        const requestResult = await this.request(type);
        return requestResult.granted === true;
    }
};
