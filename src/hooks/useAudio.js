import { useState, useEffect, useCallback } from 'react';
import audioManager from '../utils/audioManager';

export function useAudio() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCrossfading, setIsCrossfading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [bpm, setBpm] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const initialize = useCallback(async () => {
    await audioManager.initialize();
  }, []);

  const loadFile = useCallback(async (file) => {
    try {
      const buffer = await audioManager.loadAudioFile(file);
      setDuration(audioManager.getDuration());
      setBpm(audioManager.getBPM());
      setIsLoaded(true);
      return buffer;
    } catch (error) {
      console.error('Failed to load file:', error);
      throw error;
    }
  }, []);

  const loadFromUrl = useCallback(async (url) => {
    try {
      const buffer = await audioManager.loadAudioFromUrl(url);
      setDuration(audioManager.getDuration());
      setIsLoaded(true);
      return buffer;
    } catch (error) {
      console.error('Failed to load from URL:', error);
      throw error;
    }
  }, []);

  const play = useCallback(() => {
    audioManager.play();
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    audioManager.pause();
    setIsPlaying(false);
  }, []);

  const resume = useCallback(() => {
    audioManager.resume();
    setIsPlaying(true);
  }, []);

  const stop = useCallback(() => {
    audioManager.stop();
    setIsPlaying(false);
    setIsCrossfading(false);
  }, []);

  const crossfadeTo = useCallback((nextBuffer) => {
    audioManager.crossfadeTo(nextBuffer);
    setIsCrossfading(true);
  }, []);

  const setVolume = useCallback((volume) => {
    audioManager.setVolume(volume);
  }, []);

  // Update current time while playing
  useEffect(() => {
    let interval;
    if (isPlaying && !isCrossfading) {
      interval = setInterval(() => {
        setCurrentTime(audioManager.getCurrentTime() % duration);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isCrossfading, duration]);

  return {
    isPlaying,
    isCrossfading,
    duration,
    currentTime,
    bpm,
    isLoaded,
    initialize,
    loadFile,
    loadFromUrl,
    play,
    pause,
    resume,
    stop,
    crossfadeTo,
    setVolume
  };
}