self.onmessage = function (event) {
    const rawJsonString = event.data;
    try {
        const parsedData = JSON.parse(rawJsonString);
        self.postMessage({ status: 'complete', data: parsedData });
    } catch (error) {
        self.postMessage({ status: 'error', message: error.message });
    }
};