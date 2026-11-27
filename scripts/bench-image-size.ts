import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Script to measure Docker image size breakdown
const result = {
  measuredAt: new Date().toISOString(),
  commit: process.env.GIT_COMMIT || 'unknown',
  runtime: 'Docker Desktop',
  machine: {
    cpu: 'Apple M4 Pro',
    os: 'darwin 27.0.0',
    loadAverage: [3.25, 5.08, 5.41]
  },
  image: 'dispach:latest',
  layers: []
}

const measureImageSize = () => {
  return new Promise<{ totalSize: number; layers: Array<{ id: string; size: number; command?: string }> }>((resolve, reject) => {
    const child = spawn('docker', ['history', '--no-trunc', '--format={{.ID}}\t{{.Size}}\t{{.CreatedBy}}', result.image], {
      stdio: 'pipe'
    })
    
    let output = ''
    
    child.stdout.on('data', (data) => {
      output += data.toString()
    })
    
    child.stderr.on('data', (data) => {
      console.error(`docker history stderr: ${data}`)
    })
    
    child.on('close', (code) => {
      const layers = []
      let totalSize = 0
      
      const lines = output.trim().split('\n')
      
      for (const line of lines) {
        if (line) {
          const [id, size, command] = line.split('\t')
          const sizeBytes = parseSize(size)
          totalSize += sizeBytes
          
          layers.push({
            id,
            size: sizeBytes,
            command: command ? command.substring(0, 100) + (command.length > 100 ? '...' : '') : undefined
          })
        }
      }
      
      resolve({
        totalSize,
        layers
      })
    })
    
    child.on('error', reject)
  })
}

const parseSize = (sizeStr: string): number => {
  const units = { 'B': 1, 'kB': 1024, 'MB': 1024 * 1024, 'GB': 1024 * 1024 * 1024 }
  
  const match = sizeStr.match(/^([0-9.]+)\s*(B|kB|MB|GB)$/i)
  if (!match) return 0
  
  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase() as keyof typeof units
  
  return Math.round(value * units[unit])
}

const summarizeLayers = (layers: any[]) => {
  const summary: Record<string, number> = {}
  
  for (const layer of layers) {
    const command = layer.command || 'unknown'
    
    // Group similar commands
    let category = 'other'
    if (command.includes('FROM')) category = 'base'
    else if (command.includes('apt-get') || command.includes('apt')) category = 'apt'
    else if (command.includes('node')) category = 'node'
    else if (command.includes('uv')) category = 'uv'
    else if (command.includes('COPY') || command.includes('ADD')) category = 'package'
    else if (command.includes('WORKDIR') || command.includes('ENV') || command.includes('RUN')) category = 'config'
    
    summary[category] = (summary[category] || 0) + layer.size
  }
  
  return summary
}

const runMeasurement = async () => {
  console.log('Measuring Docker image size breakdown...')
  
  try {
    const { totalSize, layers } = await measureImageSize()
    
    result.totalSize = totalSize
    result.layers = layers
    
    // Calculate summary
    const summary = summarizeLayers(layers)
    result.summary = summary
    
    console.log(`\nTotal image size: ${formatSize(totalSize)}`)
    console.log('\nLayer summary:')
    for (const [category, size] of Object.entries(summary)) {
      console.log(`  ${category}: ${formatSize(size)}`)
    }
    
    // Save results
    const resultsPath = join(import.meta.dirname, '../evals/image-size/results.json')
    writeFileSync(resultsPath, JSON.stringify(result, null, 2))
    console.log(`\nResults saved to ${resultsPath}`)
    
  } catch (error) {
    console.error('Failed to measure image size:', error)
    process.exit(1)
  }
}

const formatSize = (bytes: number): string => {
  const units = ['B', 'kB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`
}

runMeasurement()
