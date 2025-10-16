/* Claude Usage Monitor - Background Service Worker */

const POLL_INTERVAL_MINUTES = 5;
const ALARM_NAME = 'usagePoll';

/* Initialize on install */
chrome.runtime.onInstalled.addListener(() => {
  console.log('Claude Usage Monitor installed');
  initializeMonitoring();
});

/* Resume monitoring on startup */
chrome.runtime.onStartup.addListener(() => {
  console.log('Claude Usage Monitor started');
  initializeMonitoring();
});

/* Handle icon click - open usage page */
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'https://claude.ai/settings/usage' });
});

/* Set up periodic polling */
async function initializeMonitoring() {
  /* Clear any existing alarms */
  await chrome.alarms.clear(ALARM_NAME);
  
  /* Create alarm for periodic updates */
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: POLL_INTERVAL_MINUTES
  });
  
  /* Fetch immediately on init */
  await fetchAndUpdateUsage();
}

/* Listen for alarm */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('Polling Claude usage...');
    fetchAndUpdateUsage();
  }
});

/* Fetch usage data and update badge */
async function fetchAndUpdateUsage() {
  try {
    /* Get org ID (cached or fetch fresh) */
    const orgId = await getOrganizationId();
    
    if (!orgId) {
      updateBadgeError('No org ID');
      return;
    }
    
    /* Fetch usage data */
    const usageUrl = `https://claude.ai/api/organizations/${orgId}/usage`;
    const response = await fetch(usageUrl, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Usage data:', data);
    
    /* Update badge with data */
    updateBadge(data);
    
  } catch (error) {
    console.error('Failed to fetch usage:', error);
    updateBadgeError(error.message);
  }
}

/* Get organization ID from bootstrap API */
async function getOrganizationId() {
  try {
    /* Check cache first */
    const cached = await chrome.storage.local.get('orgId');
    if (cached.orgId) {
      console.log('Using cached org ID:', cached.orgId);
      return cached.orgId;
    }
    
    /* Fetch from bootstrap API */
    console.log('Fetching org ID from bootstrap...');
    const response = await fetch('https://claude.ai/api/bootstrap', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Bootstrap failed: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    /* Extract org ID from response */
    const orgId = data?.account?.memberships?.[0]?.organization?.uuid;
    
    if (!orgId) {
      throw new Error('Org ID not found in bootstrap response');
    }
    
    /* Cache it */
    await chrome.storage.local.set({ orgId });
    console.log('Cached org ID:', orgId);
    
    return orgId;
    
  } catch (error) {
    console.error('Failed to get org ID:', error);
    return null;
  }
}

/* Generate canvas-based icon with circular progress indicator */
function generateIcon(percentage, size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  /* Determine color based on percentage */
  let progressColor;
  if (percentage < 50) {
    progressColor = '#10b981'; /* Green */
  } else if (percentage < 80) {
    progressColor = '#f59e0b'; /* Yellow */
  } else {
    progressColor = '#ef4444'; /* Red */
  }
  
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 2 - 2;
  const lineWidth = Math.max(2, size / 8);
  
  /* Clear canvas */
  ctx.clearRect(0, 0, size, size);
  
  /* Draw background circle */
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  
  /* Draw progress arc */
  const startAngle = -Math.PI / 2; /* Start at top */
  const endAngle = startAngle + (percentage / 100) * 2 * Math.PI;
  
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, startAngle, endAngle);
  ctx.strokeStyle = progressColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();
  
  /* Draw percentage text (only for larger sizes) */
  if (size >= 32) {
    ctx.fillStyle = '#1f2937';
    ctx.font = `bold ${size / 3}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${percentage}%`, centerX, centerY);
  }
  
  return ctx.getImageData(0, 0, size, size);
}

/* Update icon and badge with usage data */
function updateBadge(data) {
  const fiveHour = data.five_hour;
  
  if (!fiveHour) {
    updateBadgeError('No data');
    return;
  }
  
  const percentage = fiveHour.utilization || 0;
  const resetsAt = fiveHour.resets_at;
  
  /* Generate dynamic icons at multiple sizes */
  const icon16 = generateIcon(percentage, 16);
  const icon32 = generateIcon(percentage, 32);
  const icon48 = generateIcon(percentage, 48);
  
  /* Set the dynamic icon */
  chrome.action.setIcon({
    imageData: {
      16: icon16,
      32: icon32,
      48: icon48
    }
  });
  
  /* Set badge text with percentage */
  chrome.action.setBadgeText({ text: `${percentage}%` });
  
  /* Set Claude orange color for badge text */
  chrome.action.setBadgeTextColor({ color: '#D97706' });
  
  /* Set transparent background */
  chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
  
  /* Format reset time for tooltip */
  let resetTimeStr = 'Unknown';
  if (resetsAt) {
    const resetDate = new Date(resetsAt);
    resetTimeStr = resetDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
  
  /* Set detailed tooltip */
  const title = `Claude Usage Monitor\n${percentage}% used\nResets at ${resetTimeStr}`;
  chrome.action.setTitle({ title });
  
  console.log(`Icon updated: ${percentage}% used, resets at ${resetTimeStr}`);
}

/* Update badge to show error state */
function updateBadgeError(message) {
  /* Generate gray error icon */
  const size = 48;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 2 - 2;
  
  /* Draw gray circle */
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.fillStyle = '#6b7280';
  ctx.fill();
  
  /* Draw exclamation mark */
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${size / 2}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', centerX, centerY);
  
  const errorIcon = ctx.getImageData(0, 0, size, size);
  
  chrome.action.setIcon({
    imageData: {
      16: errorIcon,
      32: errorIcon,
      48: errorIcon
    }
  });
  
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setTitle({ title: `Claude Usage Monitor\nError: ${message}` });
}
