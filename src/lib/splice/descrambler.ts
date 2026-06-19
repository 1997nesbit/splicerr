export function descrambleSample(data: Uint8Array) {
    const dataSize = data
        .subarray(2, 10)
        .reduce(
            (accumulator, byte, index) => accumulator + byte * 256 ** index,
            0
        )
    const encodingBlock = String.fromCharCode(...data.subarray(10, 28))
    const audioData = data.slice(28)

    let passIndex = descramblePass(0, audioData, encodingBlock, dataSize) + dataSize
    descramblePass(passIndex, audioData, encodingBlock, passIndex + dataSize)

    return audioData
}

function descramblePass(
    startIndex: number,
    data: Uint8Array,
    encodingBlock: string,
    dataSize: number
) {
    for (
        let encodingIndex = 0;
        startIndex < dataSize;
        startIndex++, encodingIndex = (encodingIndex + 1) % encodingBlock.length
    ) {
        data[startIndex] ^= encodingBlock.charCodeAt(encodingIndex)
    }
    return startIndex
}
