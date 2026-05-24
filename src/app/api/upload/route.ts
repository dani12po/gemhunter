import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const apiKey = process.env.PINATA_API_KEY;
    const secretKey = process.env.PINATA_SECRET_KEY;

    if (!apiKey || !secretKey) {
      return NextResponse.json({ 
        success: false, 
        error: 'Pinata API keys are missing in .env.local' 
      }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get('logo') as File;
    const name = formData.get('name') as string;
    const symbol = formData.get('symbol') as string;
    const description = formData.get('description') as string;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    // 1. Upload Image to Pinata using fetch (more stable than SDK streams)
    const imageFormData = new FormData();
    imageFormData.append('file', file);
    
    const metadata = JSON.stringify({
      name: `${name}-logo-${Date.now()}`,
    });
    imageFormData.append('pinataMetadata', metadata);

    const imageRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': secretKey,
      },
      body: imageFormData,
    });

    if (!imageRes.ok) {
      const errorData = await imageRes.json();
      throw new Error(`Pinata Image Upload Error: ${errorData.error || imageRes.statusText}`);
    }

    const imageData = await imageRes.json();
    const imageUrl = `https://gateway.pinata.cloud/ipfs/${imageData.IpfsHash}`;

    // 2. Create Metaplex standard Metadata JSON
    const metadataJson = {
      name: name,
      symbol: symbol,
      description: description,
      image: imageUrl,
      external_url: "",
      attributes: [],
      properties: {
        files: [{ uri: imageUrl, type: file.type }],
        category: "image"
      }
    };

    // 3. Upload JSON to Pinata
    const jsonRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': secretKey,
      },
      body: JSON.stringify({
        pinataContent: metadataJson,
        pinataMetadata: { name: `${name}-metadata.json` }
      }),
    });

    if (!jsonRes.ok) {
      const errorData = await jsonRes.json();
      throw new Error(`Pinata JSON Upload Error: ${errorData.error || jsonRes.statusText}`);
    }

    const jsonData = await jsonRes.json();
    const metadataUrl = `https://gateway.pinata.cloud/ipfs/${jsonData.IpfsHash}`;

    return NextResponse.json({ success: true, metadataUrl });
    
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
